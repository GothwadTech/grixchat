import React, { useState, useEffect, useCallback } from 'react';
import { Github, RefreshCw, Key, CheckCircle, ExternalLink,
  User, Folder, Layers, GitCommit, Activity, GitBranch, Search, CheckSquare, Square, UploadCloud, AlertTriangle, CheckCircle2, Wifi, ShieldCheck, Database, ChevronLeft
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { storage } from '../../services/StorageService';
import { motion } from 'motion/react';
import GithubProfileHeader from './components/GithubProfileHeader';
import GithubZipUploader from './components/GithubZipUploader';
import GithubFileList from './components/GithubFileList';
import { calculateGitHubBlobSha } from './utils/githubSha';

interface GitHubProfile {
  login: string;
  avatar_url: string;
  name: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  html_url: string;
}

interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
}

interface ExtractedFile {
  path: string;
  name: string;
  content: string; // Base64 encoding
  sha: string;
  size: number;
}

interface RemoteFileRef {
  path: string;
  sha: string;
}

type TabType = 'account' | 'repos' | 'workspace' | 'deploy' | 'diagnostics';

export default function GithubScreen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('account');
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<GitHubProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  
  const [manualToken, setManualToken] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [authUrlLoading, setAuthUrlLoading] = useState(false);
  const [commitSuccessUrl, setCommitSuccessUrl] = useState<string | null>(null);

  // Repository list states
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [repoSearch, setRepoSearch] = useState('');
  const [branch, setBranch] = useState('main');

  // Push / deploy states
  const [commitMessage, setCommitMessage] = useState('sync: deploy custom code via GrixChat');
  const [syncType, setSyncType] = useState<'app' | 'zip'>('zip');
  const [isSequential, setIsSequential] = useState(false);
  
  // File selections states
  const [zipFiles, setZipFiles] = useState<ExtractedFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<RemoteFileRef[]>([]);
  
  const [appCodeFiles, setAppCodeFiles] = useState<string[]>([]);
  const [selectedAppFiles, setSelectedAppFiles] = useState<string[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [loadingAppFiles, setLoadingAppFiles] = useState(false);

  // Push execution states
  const [isPushing, setIsPushing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [noChangesWarning, setNoChangesWarning] = useState(false);

  // Push live progress metric states
  const [_totalFiles, setTotalFiles] = useState(0);
  const [_filesAlreadyExist, setFilesAlreadyExist] = useState(0);
  const [_filesToUpload, setFilesToUpload] = useState(0);
  const [filesUploadedCount, setFilesUploadedCount] = useState(0);
  const [filesRemainingCount, setFilesRemainingCount] = useState(0);
  const [currentFileTransfer, setCurrentFileTransfer] = useState('');
  const [currentProgressPercent, setCurrentProgressPercent] = useState(0);

  // Diagnostics & rate states
  const [rateLimit, setRateLimit] = useState<{ limit: number, remaining: number, resetTime: string } | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [pingLatency, setPingLatency] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);

  // Load tokens & setups
  useEffect(() => {
    const token = storage.getItem('github_token');
    if (token) {
      setGithubToken(token);
      fetchGithubProfile(token);
    }
  }, []);

  // Load local codebase file directories on mount
  useEffect(() => {
    const fetchLocalFilesList = async () => {
      setLoadingAppFiles(true);
      try {
        const res = await axios.get('/api/github/list-files');
        if (res.data && res.data.files) {
          const files = res.data.files.filter(
            (f: string) => !f.includes('package-lock.json') && !f.includes('node_modules') && !f.includes('dist')
          );
          setAppCodeFiles(files);
          const defaults = files.filter(
            (f: string) => f.includes('schema') || f.includes('.env.example') || f === 'package.json'
          );
          setSelectedAppFiles(defaults.length > 0 ? defaults : files.slice(0, 5));
        }
      } catch (err) {
        console.error('Failed listing codebase folder files', err);
      } finally {
        setLoadingAppFiles(false);
      }
    };
    fetchLocalFilesList();
  }, []);

  const fetchGithubProfile = async (token: string) => {
    setLoadingProfile(true);
    setErrorMessage('');
    try {
      const response = await axios.get<GitHubProfile>('https://api.github.com/user', {
        headers: { Authorization: `token ${token}` }
      });
      setProfile(response.data);
    } catch (err: any) {
      console.error('Invalid token or GitHub unavailable', err);
      if (err.response?.status === 401) {
        storage.removeItem('github_token');
        setGithubToken(null);
      }
      setErrorMessage('Verification failed. Invalid or expired access token.');
    } finally {
      setLoadingProfile(false);
    }
  };

  const fetchRepos = useCallback(async () => {
    if (!githubToken) return;
    setLoadingRepos(true);
    setErrorMessage('');
    try {
      const response = await axios.get<Repository[]>('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: { Authorization: `token ${githubToken}` }
      });
      setRepos(response.data || []);
      // Auto select first repo if none selected yet
      if (response.data?.length > 0) {
        // Functional update: only fills the selection if still empty, no dependency on selectedRepo.
        setSelectedRepo(prev => prev ?? response.data[0]);
      }
    } catch (_err: any) {
      setErrorMessage('Failed to fetch github repositories. Check token scopes or connectivity.');
    } finally {
      setLoadingRepos(false);
    }
  }, [githubToken]);

  const fetchRemoteHashes = useCallback(async (owner: string, repoName: string, targetBranch: string): Promise<RemoteFileRef[]> => {
    if (!githubToken) return [];
    try {
      const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repoName}/branches/${targetBranch}`, {
        headers: { Authorization: `token ${githubToken}` }
      });
      const baseTreeSha = branchRes.data.commit.commit.tree.sha;
      const treeRes = await axios.get(`https://api.github.com/repos/${owner}/${repoName}/git/trees/${baseTreeSha}?recursive=1`, {
        headers: { Authorization: `token ${githubToken}` }
      });
      if (treeRes.data && treeRes.data.tree) {
        const refs = treeRes.data.tree
          .filter((n: any) => n.type === 'blob')
          .map((n: any) => ({ path: n.path, sha: n.sha }));
        setRemoteFiles(refs);
        return refs;
      }
      return [];
    } catch (e) {
      console.warn('Unable to query remote code trees. Assuming initial upstream branch push.', e);
      setRemoteFiles([]);
      return [];
    }
  }, [githubToken]);

  const fetchRateInfo = useCallback(async () => {
    if (!githubToken) return;
    setRateLoading(true);
    try {
      const res = await axios.get('https://api.github.com/rate_limit', {
        headers: { Authorization: `token ${githubToken}` }
      });
      if (res.data && res.data.resources) {
        const core = res.data.resources.core;
        const resetDate = new Date(core.reset * 1000).toLocaleTimeString();
        setRateLimit({
          limit: core.limit,
          remaining: core.remaining,
          resetTime: resetDate
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRateLoading(false);
    }
  }, [githubToken]);

  useEffect(() => {
    if (githubToken) {
      fetchRepos();
      fetchRateInfo();
      testGithubPing();
    }
  }, [githubToken, fetchRepos, fetchRateInfo]);

  // Handle repository connection changes to load remote file indexes
  useEffect(() => {
    if (selectedRepo && githubToken) {
      fetchRemoteHashes(selectedRepo.owner.login, selectedRepo.name, branch);
    }
  }, [selectedRepo, branch, githubToken, fetchRemoteHashes]);

  const testGithubPing = async () => {
    setPinging(true);
    const start = Date.now();
    try {
      await axios.get('https://api.github.com/zen');
      setPingLatency(`${Date.now() - start}ms`);
    } catch (_e) {
      setPingLatency('Unreachable');
    } finally {
      setPinging(false);
    }
  };

  const handleOauthConnect = async () => {
    setAuthUrlLoading(true);
    setErrorMessage('');
    try {
      const res = await axios.get('/api/github/auth-url');
      if (res.data && res.data.url) {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        const _popup = window.open(
          res.data.url, 
          'github-auth', 
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );

        const handleMessageEvent = (event: MessageEvent) => {
          if (event.data && event.data.type === 'GITHUB_AUTH_SUCCESS') {
            const token = event.data.token;
            storage.setItem('github_token', token);
            setGithubToken(token);
            fetchGithubProfile(token);
            window.removeEventListener('message', handleMessageEvent);
          }
        };

        window.addEventListener('message', handleMessageEvent);
      }
    } catch (err) {
      console.error('Failed to get GitHub auth url', err);
      setShowManualInput(true);
    } finally {
      setAuthUrlLoading(false);
    }
  };

  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    const token = manualToken.trim();
    storage.setItem('github_token', token);
    setGithubToken(token);
    fetchGithubProfile(token);
    setManualToken('');
  };

  const handleDisconnect = () => {
    storage.removeItem('github_token');
    setGithubToken(null);
    setProfile(null);
    setCommitSuccessUrl(null);
    setSelectedRepo(null);
    setRepos([]);
  };

  const handleZipFilesReady = (filesReady: ExtractedFile[]) => {
    setZipFiles(filesReady);
    setSelectedPaths(filesReady.map(f => f.path));
    setNoChangesWarning(false);
  };

  const handleUpdateZipFile = (idx: number, updated: ExtractedFile) => {
    setZipFiles(prev => {
      const copy = [...prev];
      copy[idx] = updated;
      return copy;
    });
  };

  const handleRemoveZipFile = (idx: number) => {
    setZipFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleTogglePath = (path: string) => {
    setSelectedPaths(prev => {
      if (prev.includes(path)) {
        return prev.filter(p => p !== path);
      } else {
        return [...prev, path];
      }
    });
  };

  const getPreSyncStats = () => {
    let total = 0;
    let unchanged = 0;
    let changed = 0;

    if (syncType === 'zip') {
      total = selectedPaths.length;
      const selectedZipFilesList = zipFiles.filter(zf => selectedPaths.includes(zf.path));
      selectedZipFilesList.forEach(zf => {
        const match = remoteFiles.find(rf => rf.path === zf.path);
        if (match && match.sha === zf.sha) {
          unchanged++;
        } else {
          changed++;
        }
      });
    } else {
      total = selectedAppFiles.length;
      selectedAppFiles.forEach(path => {
        const match = remoteFiles.find(rf => rf.path === path);
        if (match) {
          unchanged++;
        } else {
          changed++;
        }
      });
    }

    return { total, unchanged, changed };
  };

  const syncStats = getPreSyncStats();

  const handlePush = async () => {
    if (!selectedRepo || !githubToken) return;
    
    let finalPayload: { path: string, content: string }[] = [];
    setIsPushing(true);
    setErrorMessage('');
    setNoChangesWarning(false);
    setCommitSuccessUrl(null);
    setCurrentProgressPercent(0);
    setTotalFiles(0);
    setFilesAlreadyExist(0);
    setFilesToUpload(0);
    setFilesUploadedCount(0);
    setFilesRemainingCount(0);
    setCurrentFileTransfer('Setting up local workspace files...');

    try {
      if (syncType === 'zip') {
        if (selectedPaths.length === 0) {
          throw new Error('Please select at least one zip-extracted file to sync.');
        }
        finalPayload = zipFiles
          .filter(zf => selectedPaths.includes(zf.path))
          .map(zf => ({ path: zf.path, content: zf.content }));
      } else {
        if (selectedAppFiles.length === 0) {
          throw new Error('Please select at least one local codebase file to sync.');
        }
        setStatusMessage('Compressing and loading codebase files...');
        setCurrentFileTransfer('Scanning local workspace...');
        for (const pathStr of selectedAppFiles) {
          const res = await axios.get(`/api/github/get-file-content?path=${encodeURIComponent(pathStr)}`);
          if (res.data && res.data.content) {
            finalPayload.push({ path: pathStr, content: res.data.content });
          }
        }
      }

      setStatusMessage('Fetching latest remote repository state...');
      setCurrentFileTransfer('Retrieving upstream branch indexes...');
      const activeRemoteFiles = await fetchRemoteHashes(selectedRepo.owner.login, selectedRepo.name, branch);

      // Sequential pushes
      if (isSequential) {
        setStatusMessage('Filtering unchanged files...');
        setCurrentFileTransfer('Checking matches to bypass duplicates...');

        const modifiedFiles: { path: string, content: string }[] = [];
        for (const file of finalPayload) {
          const matchingRemote = activeRemoteFiles.find(rf => rf.path === file.path);
          let isModified = true;

          if (syncType === 'zip') {
            const zf = zipFiles.find(z => z.path === file.path);
            if (zf && matchingRemote && zf.sha === matchingRemote.sha) {
              isModified = false;
            }
          } else {
            if (matchingRemote) {
              const localSha = await calculateGitHubBlobSha(file.content);
              if (localSha && localSha === matchingRemote.sha) {
                isModified = false;
              }
            }
          }

          if (isModified) {
            modifiedFiles.push(file);
          }
        }

        if (modifiedFiles.length === 0) {
          setNoChangesWarning(true);
          setIsPushing(false);
          return;
        }

        const totalCount = finalPayload.length;
        const existsCount = totalCount - modifiedFiles.length;
        setTotalFiles(totalCount);
        setFilesAlreadyExist(existsCount);
        setFilesToUpload(modifiedFiles.length);
        setFilesUploadedCount(0);
        setFilesRemainingCount(modifiedFiles.length);
        setCurrentProgressPercent(0);

        for (let i = 0; i < modifiedFiles.length; i++) {
          const file = modifiedFiles[i];
          const matchingRemote = activeRemoteFiles.find(rf => rf.path === file.path);
          const sha = matchingRemote?.sha;

          let loc = 0;
          try {
            const decoded = window.atob(file.content);
            loc = decoded.split(/\r?\n/).length;
          } catch(_e) { /* intentionally ignored: best-effort, failure is non-fatal */ }

          setCurrentFileTransfer(`Pushing: ${file.path} (${loc} lines)`);
          setStatusMessage(`Uploading file ${i + 1}/${modifiedFiles.length}...`);

          try {
            const putRes = await axios.put(`https://api.github.com/repos/${selectedRepo.owner.login}/${selectedRepo.name}/contents/${file.path}`, {
              message: `${commitMessage} - update ${file.path}`,
              content: file.content,
              sha: sha || undefined,
              branch
            }, {
              headers: {
                Authorization: `token ${githubToken}`,
                Accept: 'application/vnd.github.v3+json'
              }
            });

            if (putRes.data?.content?.sha) {
              const newSha = putRes.data.content.sha;
              const idx = activeRemoteFiles.findIndex(rf => rf.path === file.path);
              if (idx > -1) activeRemoteFiles[idx].sha = newSha;
              else activeRemoteFiles.push({ path: file.path, sha: newSha });
              setRemoteFiles([...activeRemoteFiles]);
            }
          } catch (fileErr: any) {
            const errorDetail = fileErr.response?.data?.message || fileErr.message;
            throw new Error(`Sequential sync stopped at "${file.path}": ${errorDetail}`);
          }

          const currentUploaded = i + 1;
          setFilesUploadedCount(currentUploaded);
          setFilesRemainingCount(modifiedFiles.length - currentUploaded);
          setCurrentProgressPercent(Math.round((currentUploaded / modifiedFiles.length) * 100));

          await new Promise(resolve => setTimeout(resolve, 300));
        }

        fetchRemoteHashes(selectedRepo.owner.login, selectedRepo.name, branch);
        setCommitSuccessUrl(`https://github.com/${selectedRepo.full_name}/commits/${branch}`);
        setIsPushing(false);
        return;
      }

      // Fast Bulk Batch Process Mode
      setStatusMessage('Analyzing and sending bulk commits to bridge...');
      
      let modifiedCount = 0;
      for (const file of finalPayload) {
        const matchingRemote = activeRemoteFiles.find(rf => rf.path === file.path);
        let isModified = true;
        if (syncType === 'zip') {
          const zf = zipFiles.find(z => z.path === file.path);
          if (zf && matchingRemote && zf.sha === matchingRemote.sha) {
            isModified = false;
          }
        } else {
          if (matchingRemote) {
            const localSha = await calculateGitHubBlobSha(file.content);
            if (localSha && localSha === matchingRemote.sha) {
              isModified = false;
            }
          }
        }
        if (isModified) modifiedCount++;
      }

      const totalCount = finalPayload.length;
      setTotalFiles(totalCount);
      setFilesAlreadyExist(totalCount - modifiedCount);
      setFilesToUpload(modifiedCount);
      setFilesUploadedCount(0);
      setFilesRemainingCount(modifiedCount);
      setCurrentProgressPercent(10);
      setCurrentFileTransfer("Staging bulk files and compression delta...");

      const messagesList = [
        "Connecting upstream repositories branch...",
        "Evaluating remote file diff matrices...",
        "Packing zipped delta trees...",
        "Pushing commit binary blobs to GitHub...",
        "Verifying branch state sync reference points...",
        "Sync complete!"
      ];
      
      let messageIdx = 0;
      const progressTimer = setInterval(() => {
        setCurrentProgressPercent(prev => {
          if (prev >= 92) return prev;
          return prev + Math.max(1, Math.floor((92 - prev) / 6));
        });
        
        if (messageIdx < messagesList.length) {
          setCurrentFileTransfer(messagesList[messageIdx]);
          setStatusMessage(messagesList[messageIdx]);
          messageIdx++;
        }
      }, 700);

      try {
        const pushRes = await axios.post('/api/github/push-batch', {
          token: githubToken,
          owner: selectedRepo.owner.login,
          repo: selectedRepo.name,
          files: finalPayload,
          message: commitMessage,
          branch: branch,
          isSequential: false
        });

        clearInterval(progressTimer);
        setCurrentProgressPercent(100);
        setCurrentFileTransfer("Signature validation verified!");

        if (pushRes.data) {
          if (pushRes.data.noChanges) {
            setNoChangesWarning(true);
          } else {
            setFilesUploadedCount(modifiedCount);
            setFilesRemainingCount(0);
            setCommitSuccessUrl(pushRes.data.html_url || `https://github.com/${selectedRepo.full_name}`);
          }
        }
      } catch (err: any) {
        clearInterval(progressTimer);
        throw err;
      }

    } catch (err: any) {
      const detail = err.response?.data?.message || err.message;
      setErrorMessage(detail);
    } finally {
      setIsPushing(false);
    }
  };

  const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(repoSearch.toLowerCase()));
  const filteredAppFiles = appCodeFiles.filter(f => f.toLowerCase().includes(fileSearch.toLowerCase()));

  // Setup tabs config dataset
  const tabsList = [
    { id: 'account' as TabType, icon: User, label: 'Account' },
    { id: 'repos' as TabType, icon: Folder, label: 'Repos' },
    { id: 'workspace' as TabType, icon: Layers, label: 'Workspace' },
    { id: 'deploy' as TabType, icon: GitCommit, label: 'Deploy' },
    { id: 'diagnostics' as TabType, icon: Activity, label: 'Diagnostics' }
  ];

  return (
    <div className="h-full flex flex-col bg-[var(--bg-main)] overflow-hidden">
      
      {/* Top Header Panel (Matches SettingHeader / TabHeader Design exactly) */}
      <div className="w-full bg-[var(--header-bg)] px-4 min-h-[56px] pt-safe pb-1.5 flex items-center gap-3 z-50 shrink-0 relative border-b border-[var(--border-color)]/35 shadow-sm rounded-b-2xl select-none">
        <button aria-label="Back" 
          onClick={() => navigate('/profile')} 
          className="p-2 hover:bg-black/5 rounded-full transition-colors cursor-pointer"
        >
          <ChevronLeft size={24} className="text-[var(--header-text)]" />
        </button>
        <h1 className="text-xl font-black text-[var(--header-text)] tracking-tight">
          Github
        </h1>
      </div>

      {/* Main Tab Screen Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-20">
        
        {/* Render Error messages consistently at the top */}
        {errorMessage && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl p-4 text-xs font-bold flex gap-2.5 shadow-sm animate-shake">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 space-y-0.5">
              <p className="font-extrabold">Operation Failure</p>
              <p className="text-[11px] leading-relaxed opacity-90">{errorMessage}</p>
            </div>
          </div>
        )}

        {noChangesWarning && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex gap-3 text-amber-600 font-semibold shadow-sm animate-fade-in animate-bounce">
            <CheckCircle2 size={18} className="shrink-0 text-amber-500 mt-0.5" />
            <div className="flex-1 space-y-0.5">
              <p className="font-extrabold text-xs">Everything is already up-to-date!</p>
              <p className="text-[11px] leading-normal opacity-90">Your local directory content matches the remote repository exactly. No modifications to commit.</p>
            </div>
          </div>
        )}

        {/* ===================== TAB 1: ACCOUNT ===================== */}
        {activeTab === 'account' && (
          <div className="space-y-4 animate-fade-in select-none">
            {!githubToken ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 border border-[var(--border-color)]/60 text-center space-y-4 shadow-sm">
                <div className="w-14 h-14 bg-zinc-950 text-white rounded-2xl flex items-center justify-center mx-auto shadow-inner border border-zinc-900">
                  <Github size={32} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-[var(--text-primary)]">Sync with GitHub</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed max-w-xs mx-auto">
                    Securely link your account to sync your database templates, SQL files, and custom schemas directory straight into your remote repository.
                  </p>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={handleOauthConnect}
                    disabled={authUrlLoading}
                    className="w-full h-11 bg-zinc-950 border border-zinc-900 text-white active:scale-95 hover:bg-black transition-all rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    {authUrlLoading ? (
                      <RefreshCw size={13} className="animate-spin text-white" />
                    ) : (
                      <Github size={14} className="fill-current" />
                    )}
                    <span>Connect GitHub Authorization</span>
                  </button>

                  <button
                    onClick={() => setShowManualInput(!showManualInput)}
                    className="text-xs text-[var(--text-secondary)] font-bold decoration-dotted underline cursor-pointer"
                  >
                    Have a Personal Access Token? (PAT)
                  </button>
                </div>
              </div>
            ) : loadingProfile ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-3">
                <RefreshCw className="animate-spin text-emerald-500" size={24} />
                <span className="text-xs text-[var(--text-secondary)] font-bold">Verifying credentials...</span>
              </div>
            ) : (
              profile && (
                <div className="space-y-4">
                  <GithubProfileHeader profile={profile} onDisconnect={handleDisconnect} />
                  
                  <div className="bg-[var(--bg-card)] rounded-2xl p-5 border border-[var(--border-color)]/65 shadow-inner space-y-3">
                    <h4 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.12em]">
                      Access Level Verified
                    </h4>
                    
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] font-bold">
                        <ShieldCheck size={14} className="text-emerald-500" />
                        <span>Core scope sync: standard repo write enabled</span>
                      </div>
                      
                      <div className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] font-bold">
                        <Wifi size={14} className="text-[#0494f4]" />
                        <span>Connected to api.github.com endpoint</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            {showManualInput && !githubToken && (
              <form onSubmit={handleManualTokenSubmit} className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/60 space-y-3 shadow-inner">
                <div className="flex items-center gap-2 text-xs text-[var(--text-primary)] font-black uppercase">
                  <Key size={13} className="text-amber-500" />
                  <span>Paste GitHub Access Token</span>
                </div>
                <p className="text-[10px] text-[var(--text-secondary)] leading-normal">
                  If the auth callback is restricted in PWA container, paste a token with <strong className="font-bold">repo</strong> scope here.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-color)] text-[var(--box-text)] focus:outline-none placeholder:opacity-50 font-mono"
                  />
                  <button
                    type="submit"
                    className="bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase transition-all"
                  >
                    Load
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ===================== TAB 2: REPOSITORIES ===================== */}
        {activeTab === 'repos' && (
          <div className="space-y-4 animate-fade-in">
            {!githubToken ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 text-center border border-[var(--border-color)]/50 space-y-3.5">
                <p className="text-xs text-[var(--text-secondary)] font-bold">Please authorized your GitHub account on Account tab first.</p>
                <button onClick={() => setActiveTab('account')} className="bg-[#0479c2] text-white font-extrabold text-xs uppercase px-4 py-2.5 rounded-xl shadow-md">
                  Go to Account Tab
                </button>
              </div>
            ) : loadingRepos ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-3">
                <RefreshCw className="animate-spin text-emerald-500" size={24} />
                <span className="text-xs text-[var(--text-secondary)]">Retrieving remote repositories list...</span>
              </div>
            ) : (
              <div className="space-y-4">
                
                {/* Branch settings */}
                <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-primary)] font-black uppercase">
                    <GitBranch size={14} className="text-[#0494f4]" />
                    <span>Deployment Parameters</span>
                  </div>
                  
                  <div className="space-y-1">
                    <label htmlFor="fld-v3u1x0" className="text-[9px] font-black text-[var(--text-secondary)] uppercase">Branch Target name</label>
                    <input id="fld-v3u1x0" 
                      type="text" 
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="w-full text-xs px-3 py-2.5 bg-[var(--bg-main)] rounded-xl border border-[var(--border-color)] font-mono text-[var(--text-primary)] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Repositories selection */}
                <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 bg-[var(--bg-main)] rounded-xl px-3 py-2.5 border border-[var(--border-color)]">
                    <Search size={15} className="text-[var(--text-secondary)]/50" />
                    <input 
                      type="text" 
                      placeholder="Search repositories..."
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text-primary)] placeholder:opacity-50"
                    />
                  </div>

                  <div className="space-y-2 max-h-[280px] overflow-y-auto no-scrollbar">
                    {filteredRepos.length === 0 ? (
                      <p className="text-center py-8 text-xs text-[var(--text-secondary)]">No repositories found matching filter.</p>
                    ) : (
                      filteredRepos.map((repo) => {
                        const isSelected = selectedRepo?.id === repo.id;
                        return (
                          <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }}
                            key={repo.id}
                            onClick={() => setSelectedRepo(repo)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                              isSelected 
                                ? 'border-[#0494f4] bg-[#0479c2]/5 border-l-[4px] text-[#0494f4]' 
                                : 'border-[var(--border-color)] hover:bg-[var(--box-bg)] text-[var(--text-primary)]'
                            }`}
                          >
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="p-1.5 bg-zinc-950 text-white rounded-lg border border-zinc-900">
                                <Github size={12} />
                              </span>
                              <div className="truncate">
                                <p className="text-xs font-extrabold truncate">{repo.name}</p>
                                <p className="text-[9px] text-[var(--text-secondary)]/80 font-mono">{repo.full_name}</p>
                              </div>
                            </div>
                            
                            {isSelected && (
                              <CheckCircle size={14} className="text-[#0494f4] shrink-0" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 3: WORKSPACE ===================== */}
        {activeTab === 'workspace' && (
          <div className="space-y-4 animate-fade-in">
            {!githubToken ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 text-center border border-[var(--border-color)]/50 space-y-3">
                <p className="text-xs text-[var(--text-secondary)] font-bold">Please authorize your GitHub account first.</p>
                <button onClick={() => setActiveTab('account')} className="bg-[#0479c2] text-white font-extrabold text-xs uppercase px-4 py-2.5 rounded-xl">Go to Account</button>
              </div>
            ) : !selectedRepo ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 text-center border border-[var(--border-color)]/50 space-y-3">
                <p className="text-xs text-[var(--text-secondary)] font-bold">Please select a target repository first.</p>
                <button onClick={() => setActiveTab('repos')} className="bg-[#0479c2] text-white font-extrabold text-xs uppercase px-4 py-2.5 rounded-xl">Go to Repositories</button>
              </div>
            ) : (
              <div className="space-y-4">
                
                {/* Sync source selector */}
                <div className="bg-[var(--bg-card)] rounded-2xl p-3 border border-[var(--border-color)]/50 shadow-sm flex gap-2">
                  <button
                    onClick={() => setSyncType('zip')}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase transition-all tracking-wider ${
                      syncType === 'zip' 
                        ? 'bg-zinc-950 text-white shadow-md' 
                        : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--box-bg)]'
                    }`}
                  >
                    ZIP Archive Extractor
                  </button>
                  
                  <button
                    onClick={() => setSyncType('app')}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase transition-all tracking-wider ${
                      syncType === 'app' 
                        ? 'bg-zinc-950 text-white shadow-md' 
                        : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--box-bg)]'
                    }`}
                  >
                    Local Codebase Sync
                  </button>
                </div>

                {/* Sync type 1: ZIP extractions */}
                {syncType === 'zip' && (
                  <div className="space-y-4">
                    <GithubZipUploader onFilesExtracted={handleZipFilesReady} />

                    {zipFiles.length > 0 && (
                      <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 shadow-sm space-y-3.5">
                        <div className="flex justify-between items-center pb-2 border-b border-[var(--border-color)]/30">
                          <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-wider">
                            ZIP File List ({zipFiles.length} files extracted)
                          </span>
                          
                          <button
                            onClick={() => {
                              setZipFiles([]);
                              setSelectedPaths([]);
                            }}
                            className="text-[9px] text-rose-500 font-extrabold uppercase bg-rose-500/10 px-2 py-1 rounded-lg"
                          >
                            Clear Loaded files
                          </button>
                        </div>

                        <GithubFileList
                          files={zipFiles}
                          remoteFiles={remoteFiles}
                          onUpdateFile={handleUpdateZipFile}
                          onRemoveFile={handleRemoveZipFile}
                          selectedPaths={selectedPaths}
                          onTogglePath={handleTogglePath}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Sync type 2: Source Codebase backup */}
                {syncType === 'app' && (
                  <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-wider">
                        Select Local Source Code
                      </span>
                      
                      <span className="text-[9px] text-[#0494f4] bg-[#0479c2]/10 border border-[#0494f4]/20 font-mono font-bold px-2 py-0.5 rounded-full">
                        {selectedAppFiles.length} / {appCodeFiles.length} Checked
                      </span>
                    </div>

                    <div className="flex items-center gap-2 bg-[var(--bg-main)] rounded-xl px-3 py-2.5 border border-[var(--border-color)]">
                      <Search size={14} className="text-[var(--text-secondary)]/50" />
                      <input 
                        type="text" 
                        placeholder="Search workspace files..."
                        value={fileSearch}
                        onChange={(e) => setFileSearch(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text-primary)]"
                      />
                    </div>

                    {loadingAppFiles ? (
                      <div className="flex items-center justify-center p-8 gap-2 text-xs text-[var(--text-secondary)] font-bold">
                        <RefreshCw size={13} className="animate-spin text-[#0494f4]" />
                        <span>Scanning directories...</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto no-scrollbar pt-1">
                        {filteredAppFiles.map((path) => {
                          const isChecked = selectedAppFiles.includes(path);
                          return (
                            <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                              key={path}
                              onClick={() => {
                                if (isChecked) {
                                  setSelectedAppFiles(prev => prev.filter(p => p !== path));
                                } else {
                                  setSelectedAppFiles(prev => [...prev, path]);
                                }
                              }}
                              className="flex items-center justify-between p-2.5 bg-[var(--bg-main)]/50 border border-[var(--border-color)]/60 rounded-xl hover:bg-[var(--box-bg)] cursor-pointer text-xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isChecked ? (
                                  <CheckSquare size={15} className="text-[#0494f4]" />
                                ) : (
                                  <Square size={15} className="text-[var(--text-secondary)]/40" />
                                )}
                                <span className="font-mono text-[11px] truncate text-[var(--text-primary)]">{path}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 4: DEPLOY ===================== */}
        {activeTab === 'deploy' && (
          <div className="space-y-4 animate-fade-in">
            {!githubToken ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 text-center border border-[var(--border-color)]/50 space-y-3">
                <p className="text-xs text-[var(--text-secondary)] font-bold">Please authorize your GitHub account first.</p>
                <button onClick={() => setActiveTab('account')} className="bg-[#0479c2] text-white font-extrabold text-xs uppercase px-4 py-2.5 rounded-xl">Go to Account</button>
              </div>
            ) : !selectedRepo ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 text-center border border-[var(--border-color)]/50 space-y-3">
                <p className="text-xs text-[var(--text-secondary)] font-bold">Please select a target repository first.</p>
                <button onClick={() => setActiveTab('repos')} className="bg-[#0479c2] text-white font-extrabold text-xs uppercase px-4 py-2.5 rounded-xl">Go to Repositories</button>
              </div>
            ) : (
              <div className="space-y-4">
                
                {/* Commit configs */}
                <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 shadow-sm space-y-3.5">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-primary)] font-black uppercase pb-1 border-b border-[var(--border-color)]/20">
                    <Database size={14} className="text-[#0494f4]" />
                    <span>Commit metadata</span>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="fld-m615i8" className="text-[9px] font-black text-[var(--text-secondary)] uppercase">Custom Commit message</label>
                    <input id="fld-m615i8" 
                      type="text" 
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="sync: deploy custom code via GrixChat"
                      className="w-full text-xs px-3 py-2.5 bg-[var(--bg-main)] rounded-xl border border-[var(--border-color)] text-[var(--text-primary)] font-bold focus:outline-none"
                    />
                  </div>

                  <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }} 
                    onClick={() => setIsSequential(prev => !prev)}
                    className="flex items-center justify-between p-3 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-xl cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-extrabold text-[var(--text-primary)]">Sequential file Sync</p>
                      <p className="text-[9px] text-[var(--text-secondary)] mt-0.5 leading-none">Bypasses huge batches for safe atomic increments</p>
                    </div>
                    
                    <div className={`w-8 h-4 rounded-full flex items-center p-0.5 transition-all ${isSequential ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
                      <div className={`w-3 h-3 bg-white rounded-full shadow-md transform transition-transform ${isSequential ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                  </div>
                </div>

                {/* Pre-Sync Staging Summary indicators */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[var(--bg-card)] border border-[var(--border-color)]/50 rounded-xl p-3 text-center">
                    <p className="text-[16px] font-black text-[var(--text-primary)]">{syncStats.total}</p>
                    <p className="text-[8px] text-[var(--text-secondary)] font-extrabold uppercase tracking-wider mt-0.5">Total files</p>
                  </div>
                  <div className="bg-[var(--bg-card)] border border-[var(--border-color)]/50 rounded-xl p-3 text-center">
                    <p className="text-[16px] font-black text-emerald-500">{syncStats.unchanged}</p>
                    <p className="text-[8px] text-[var(--text-secondary)] font-extrabold uppercase tracking-wider mt-0.5">Unchanged</p>
                  </div>
                  <div className="bg-[var(--bg-card)] border border-[var(--border-color)]/50 rounded-xl p-3 text-center">
                    <p className="text-[16px] font-black text-amber-500">{syncStats.changed}</p>
                    <p className="text-[8px] text-[var(--text-secondary)] font-extrabold uppercase tracking-wider mt-0.5">Mod / New</p>
                  </div>
                </div>

                {/* Big Push button action wrapper */}
                <button
                  onClick={handlePush}
                  disabled={isPushing || (syncType === 'zip' ? zipFiles.length === 0 : selectedAppFiles.length === 0)}
                  className="w-full h-12 bg-primary hover:bg-primary-hover text-white rounded-2xl text-xs font-black uppercase tracking-widest cursor-pointer shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {isPushing ? (
                    <RefreshCw size={14} className="animate-spin text-white" />
                  ) : (
                    <UploadCloud size={15} />
                  )}
                  <span>Push Commits to GitHub</span>
                </button>

                {/* Synced complete commit link URL display */}
                {commitSuccessUrl && (
                  <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-4 flex gap-3 text-[11px] leading-relaxed text-emerald-600 font-semibold shadow-sm animate-fade-in">
                    <CheckCircle size={18} className="shrink-0 text-emerald-500 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p>Repository syncing complete! Remote files are updated successfully.</p>
                      <a 
                        href={commitSuccessUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-500 font-extrabold underline cursor-pointer"
                      >
                        View Commit on GitHub <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                )}

                {/* Active pushing loader card panel */}
                {isPushing && (
                  <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 shadow-inner space-y-3.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-extrabold text-[var(--text-primary)]">{statusMessage}</span>
                      <span className="font-mono font-bold text-[#0494f4]">{currentProgressPercent}%</span>
                    </div>

                    <div className="w-full bg-[var(--bg-main)] rounded-full h-2 overflow-hidden border border-[var(--border-color)]/30">
                      <div 
                        className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${currentProgressPercent}%` }}
                      />
                    </div>

                    <div className="bg-[var(--bg-main)]/50 border border-[var(--border-color)]/40 p-2.5 rounded-xl text-[10px] text-[var(--text-secondary)] font-mono leading-relaxed truncate">
                      {currentFileTransfer}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono leading-none py-1.5 border-t border-[var(--border-color)]/20">
                      <div>Uploaded: <strong className="text-emerald-500 font-extrabold">{filesUploadedCount}</strong> files</div>
                      <div>Remaining: <strong className="text-amber-500 font-extrabold">{filesRemainingCount}</strong> files</div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 5: DIAGNOSTICS ===================== */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-4 animate-fade-in pb-10">
            {!githubToken ? (
              <div className="bg-[var(--bg-card)] rounded-2xl p-6 text-center border border-[var(--border-color)]/50 space-y-3">
                <p className="text-xs text-[var(--text-secondary)] font-bold">Please authorize your GitHub account first.</p>
                <button onClick={() => setActiveTab('account')} className="bg-[#0479c2] text-white font-extrabold text-xs uppercase px-4 py-2.5 rounded-xl">Go to Account</button>
              </div>
            ) : (
              <div className="space-y-4">
                
                {/* Rate limit status details metrics info */}
                <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]/30">
                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-wider">
                      API Rate Limits Monitor
                    </span>
                    
                    <button aria-label="Refresh" 
                      onClick={fetchRateInfo}
                      disabled={rateLoading}
                      className="p-1 hover:bg-[var(--box-bg)] rounded-lg transition-all text-[#0494f4]"
                    >
                      <RefreshCw size={13} className={rateLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  {rateLoading || !rateLimit ? (
                    <p className="text-center py-4 text-xs text-[var(--text-secondary)] font-bold">Querying API limit balances...</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[var(--bg-main)]/50 p-3 rounded-xl border border-[var(--border-color)]/40 text-center">
                        <p className="text-[16px] font-mono font-bold text-[var(--text-primary)]">
                          {rateLimit.remaining} / {rateLimit.limit}
                        </p>
                        <p className="text-[8px] text-[var(--text-secondary)] uppercase mt-0.5">Remaining Calls</p>
                      </div>
                      
                      <div className="bg-[var(--bg-main)]/50 p-3 rounded-xl border border-[var(--border-color)]/40 text-center">
                        <p className="text-[11px] font-mono font-bold text-[var(--text-primary)] py-0.5">
                          {rateLimit.resetTime}
                        </p>
                        <p className="text-[8px] text-[var(--text-secondary)] uppercase mt-1">Reset Window Time</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Diagnostics connectivity tests */}
                <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--border-color)]/50 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]/30">
                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-wider">
                      Gateway Diagnostic Tests
                    </span>
                    
                    <button aria-label="Refresh" 
                      onClick={testGithubPing}
                      disabled={pinging}
                      className="p-1 hover:bg-[var(--box-bg)] rounded-lg transition-all text-[#0494f4]"
                    >
                      <RefreshCw size={13} className={pinging ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="space-y-3 pt-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[var(--text-secondary)]">api.github.com Latency:</span>
                      <span className="font-mono font-bold text-[#0494f4]">{pingLatency || 'Testing...'}</span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[var(--text-secondary)]">Bridge sync connection:</span>
                      <span className="text-emerald-500 font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> Active
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[var(--text-secondary)]">Token scopes validation:</span>
                      <span className="text-emerald-500 font-bold">repo, user, gists</span>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

      </div>

      {/* Bottom Tab Bar (Curved rounded-t-2xl, matching visual console) */}
      <div className="w-full bg-[var(--header-bg)] px-2 min-h-[64px] pb-safe flex justify-around items-center z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] shrink-0 border-t border-[var(--border-color)] rounded-t-2xl select-none">
        {tabsList.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button 
              key={item.id} 
              onClick={() => setActiveTab(item.id)}
              className="relative flex flex-col items-center justify-center h-full min-w-[64px] transition-all duration-300 group cursor-pointer border-none bg-transparent outline-none focus:outline-none"
            >
              <div className="relative flex flex-col items-center">
                <motion.div 
                  animate={{ 
                    scale: isActive ? 1.15 : 1,
                    y: isActive ? -1 : 0
                  }}
                  className={`transition-colors duration-300 flex items-center justify-center ${isActive ? 'text-[var(--header-text)]' : 'text-[var(--header-text)]/50 group-hover:text-[var(--header-text)]'}`}
                >
                  <Icon 
                    size={isActive ? 24 : 20} 
                    strokeWidth={isActive ? 2.5 : 2}
                    fill={isActive ? 'currentColor' : 'none'}
                    fillOpacity={isActive ? 0.15 : 0}
                  />
                </motion.div>
              </div>
              
              <span className={`text-[10px] mt-1 font-bold transition-all duration-300 ${isActive ? 'text-[var(--header-text)] opacity-100' : 'text-[var(--header-text)]/50 opacity-75 group-hover:opacity-100'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

    </div>
  );
}
