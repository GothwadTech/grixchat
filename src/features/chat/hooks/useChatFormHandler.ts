import { useState, useCallback, useEffect, useRef } from 'react';
import { aiService } from '../../../services/AIService';
import { LocalDataCache } from '../../../services/LocalDataCache';

// Helper to convert File to base64 for persistent drafts
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

// Helper to convert base64 to File
const base64ToFile = (base64String: string, filename: string, mimeType: string): File => {
  const arr = base64String.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || mimeType;
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
};

interface UseChatFormHandlerProps {
  chatId: string;
  receiverId: string;
  user: any;
  addOptimisticMessage: (msg: any) => string;
  confirmOptimisticMessage: (tempId: string, dbMessage: any) => void;
  performSendMessage: (args: { text: string; file?: File; localPreviewUrl?: string; replyTo?: any }) => Promise<any>;
  performEditMessage: (msgId: string, text: string) => Promise<any>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export function useChatFormHandler({
  receiverId,
  user,
  addOptimisticMessage,
  confirmOptimisticMessage,
  performSendMessage,
  performEditMessage,
  textareaRef
}: UseChatFormHandlerProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [editingMessage, setEditingMessage] = useState<any | null>(null);
  const [activeMessageMenu, setActiveMessageMenu] = useState<any | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<any | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviewUrls, setFilePreviewUrls] = useState<string[]>([]);
  const [uploadProgress] = useState<number>(0);
  const [isUploading] = useState(false);
  const [newMessage, setNewMessage] = useState('');

  const isInitializingRef = useRef<string | null>(null);

  // Load draft on mount / conversation switch
  useEffect(() => {
    if (!receiverId) return;

    // Mark that we are initializing this receiver's draft to suppress immediate save cycle
    isInitializingRef.current = receiverId;

    const draft = LocalDataCache.get<any>(`draft_${receiverId}`);
    if (draft) {
      setNewMessage(draft.text || '');
      if (draft.files && Array.isArray(draft.files) && draft.files.length > 0) {
        const reconstructed: File[] = [];
        const reconstructedUrls: string[] = [];
        draft.files.forEach((fileObj: any) => {
          try {
            const file = base64ToFile(fileObj.base64, fileObj.name, fileObj.type);
            reconstructed.push(file);
            reconstructedUrls.push(URL.createObjectURL(file));
          } catch (e) {
            console.error("Error of draft file recreation:", e);
          }
        });
        setSelectedFiles(reconstructed);
        setFilePreviewUrls(reconstructedUrls);
      } else {
        setSelectedFiles([]);
        setFilePreviewUrls([]);
      }
    } else {
      setNewMessage('');
      setSelectedFiles([]);
      setFilePreviewUrls([]);
    }

    // Reset initialization guard after rendering cycle has settled
    const timer = setTimeout(() => {
      isInitializingRef.current = null;
    }, 150);

    return () => clearTimeout(timer);
  }, [receiverId]);

  // Save draft status when input variables change
  useEffect(() => {
    if (!receiverId) return;

    // Check if initialization is active
    if (isInitializingRef.current === receiverId) {
      return;
    }

    // Do not save drafts while editing an existing message
    if (editingMessage) {
      return;
    }

    // Save text portion synchronously RIGHT AWAY to guarantee no text loss ever!
    const trimmedText = newMessage.trim();
    const existing = LocalDataCache.get<any>(`draft_${receiverId}`);
    
    // Save immediate text state first (merging with existing files if they exist)
    if (!trimmedText && selectedFiles.length === 0) {
      if (existing) {
        LocalDataCache.remove(`draft_${receiverId}`);
        LocalDataCache.notify(`draft_status_${receiverId}`, null);
      }
    } else {
      const tempDraft = {
        text: newMessage,
        files: existing?.files || [] // retain previously saved serialized files
      };
      LocalDataCache.set(`draft_${receiverId}`, tempDraft);
      LocalDataCache.notify(`draft_status_${receiverId}`, tempDraft);
    }

    let active = true;

    // File base64 serialization handles asynchronously
    if (selectedFiles.length > 0) {
      const performSaveFiles = async () => {
        const filePromises = selectedFiles.map(async (file) => {
          try {
            const b64 = await fileToBase64(file);
            return {
              name: file.name,
              type: file.type,
              size: file.size,
              base64: b64,
            };
          } catch (err) {
            console.error("Error converting file to base64 for draft:", err);
            return null;
          }
        });

        const resolvedFiles = (await Promise.all(filePromises)).filter(Boolean);

        if (!active) return;

        const currentDraft = LocalDataCache.get<any>(`draft_${receiverId}`) || { text: newMessage };
        const nextDraft = {
          ...currentDraft,
          files: resolvedFiles
        };
        LocalDataCache.set(`draft_${receiverId}`, nextDraft);
        LocalDataCache.notify(`draft_status_${receiverId}`, nextDraft);
      };

      performSaveFiles();
    }

    return () => {
      active = false;
    };
  }, [newMessage, selectedFiles, receiverId, editingMessage]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !user) return;
    
    setSelectedFiles(prev => [...prev, ...files]);

    const newPreviewUrls: string[] = [];
    for (const file of files) {
      try {
        const url = URL.createObjectURL(file);
        newPreviewUrls.push(url);
      } catch (err) {
        console.warn("Could not create local URL for file:", file.name, err);
        newPreviewUrls.push('');
      }
    }
    setFilePreviewUrls(prev => [...prev, ...newPreviewUrls]);
    if (e.target) e.target.value = '';
  }, [user]);

  const handleSendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && selectedFiles.length === 0) || !user || isSending) return;
    
    const textToSend = newMessage;
    const replyContext = replyingTo;
    const editMsg = editingMessage;
    const filesToSend = [...selectedFiles];
    
    setNewMessage('');
    setReplyingTo(null);
    setEditingMessage(null);
    setSelectedFiles([]);
    setFilePreviewUrls([]);
    
    // Clear draft from storage immediately upon sending
    LocalDataCache.remove(`draft_${receiverId}`);
    LocalDataCache.notify(`draft_status_${receiverId}`, null);
    
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsSending(true);

    try {
      if (editMsg) {
        await performEditMessage(editMsg.id, textToSend);
      } else {
        if (textToSend) {
          const tempId = addOptimisticMessage({
            content: textToSend,
            type: 'text',
            reply_to: filesToSend.length === 0 ? replyContext : null
          });
          
          performSendMessage({
            text: textToSend,
            replyTo: filesToSend.length === 0 ? replyContext : null
          }).then(async result => {
            if (result && tempId) {
              confirmOptimisticMessage(tempId, result);
            }
            
            // Check if user is asking the Grix AI shortcut
            const trimmed = textToSend.trim();
            if (trimmed.toLowerCase().startsWith('/ai')) {
              // Extract original prompt after /ai
              const promptQuery = trimmed.replace(/^\/ai\s*/i, '').trim();
              if (promptQuery) {
                try {
                  const replyText = await aiService.sendMessage(
                    promptQuery,
                    "Keep your response concise, as this is happening inside a standard text thread. Always keep formatting beautifully flat and user-focused."
                  );
                  
                  // Post AI message live into the database using a custom prefix for client detection 
                  await performSendMessage({
                    text: `🤖 Grix AI: ${replyText}`,
                    replyTo: result || null
                  });
                } catch (grixErr) {
                  console.error("Grix AI inline shortcut error:", grixErr);
                }
              }
            }
          }).catch(err => {
            console.error("Error sending text:", err);
          });
        }
        
        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];
          const localUrl = filePreviewUrls[i];
          const fileType = file.type.startsWith('image/') ? 'image' : 
                           file.type.startsWith('video/') ? 'video' : 
                           file.type.startsWith('audio/') ? 'audio' : 'file';

          const tempId = addOptimisticMessage({
            content: '',
            media_url: localUrl,
            media_type: fileType,
            type: fileType,
            reply_to: i === 0 && !textToSend ? replyContext : null
          });
          
          performSendMessage({
            text: '',
            file,
            localPreviewUrl: localUrl,
            replyTo: i === 0 && !textToSend ? replyContext : null
          }).then(result => {
            if (result && tempId) {
              confirmOptimisticMessage(tempId, result);
            }
          }).catch(err => console.error("Error sending file:", err));
        }
      }
    } catch (error) {
      console.error("Error sendMessage:", error);
    } finally {
      setIsSending(false);
    }
  }, [
    newMessage, 
    selectedFiles, 
    user, 
    isSending, 
    replyingTo, 
    editingMessage, 
    filePreviewUrls, 
    performEditMessage, 
    performSendMessage, 
    addOptimisticMessage, 
    confirmOptimisticMessage, 
    textareaRef
  ]);

  const handleMessageTap = useCallback((e: any, msg: any) => {
    if (e && e.type === 'touchstart' && e.cancelable) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    
    // Support left and right clicks, capturing exact coordinates for the floating menu
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    
    if (e) {
      if (e.clientX !== undefined && e.clientY !== undefined) {
        x = e.clientX;
        y = e.clientY;
      } else if (e.touches && e.touches[0]) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      } else if (e.nativeEvent) {
        const ne = e.nativeEvent;
        if (ne.clientX !== undefined && ne.clientY !== undefined) {
          x = ne.clientX;
          y = ne.clientY;
        } else if (ne.touches && ne.touches[0]) {
          x = ne.touches[0].clientX;
          y = ne.touches[0].clientY;
        }
      }
    }

    // Attach coordinates directly to message menu item object so UI can anchor nicely
    msg._clickPos = { x, y };
    
    setActiveMessageMenu(msg);
    setShowReactionPicker(null);
    
    try {
      if (window.navigator?.vibrate) window.navigator.vibrate(5);
    } catch (_err) {
      // Ignore vibration errors
    }
  }, []);

  const handleSetReplyingTo = useCallback((msg: any) => {
    setReplyingTo(msg);
    if (msg) {
      setEditingMessage(null);
    }
  }, [setEditingMessage]);

  const startEdit = useCallback((msg: any) => {
    setEditingMessage(msg);
    setReplyingTo(null);
    setNewMessage(msg.content || msg.text || '');
    setActiveMessageMenu(null);
    setTimeout(() => {
      if (textareaRef.current) {
        const val = msg.content || msg.text || '';
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(val.length, val.length);
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
      }
    }, 100);
  }, [textareaRef, setNewMessage, setEditingMessage, setActiveMessageMenu, setReplyingTo]);

  return {
    showOptions,
    setShowOptions,
    showPlusMenu,
    setShowPlusMenu,
    isMuted,
    setIsMuted,
    replyingTo,
    setReplyingTo: handleSetReplyingTo,
    editingMessage,
    setEditingMessage,
    activeMessageMenu,
    setActiveMessageMenu,
    showReactionPicker,
    setShowReactionPicker,
    showEmojiPicker,
    setShowEmojiPicker,
    isSending,
    selectedFiles,
    setSelectedFiles,
    filePreviewUrls,
    setFilePreviewUrls,
    uploadProgress,
    isUploading,
    newMessage,
    setNewMessage,
    handleFileChange,
    handleSendMessage,
    handleMessageTap,
    startEdit
  };
}
