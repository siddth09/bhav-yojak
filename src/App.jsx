import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  ArrowRightLeft, 
  Copy, 
  Check,
  Loader2,
  Globe,
  AlertCircle,
  SendHorizontal,
  Pause,
  Key
} from 'lucide-react';

// Extensive list of Indian Languages and Dialects + English
const LANGUAGES = [
  { code: 'en', name: 'English', speechCode: 'en-IN' },
  { code: 'hi', name: 'Hindi', speechCode: 'hi-IN' },
  { code: 'bho', name: 'Bhojpuri', speechCode: 'hi-IN' }, 
  { code: 'awa', name: 'Awadhi', speechCode: 'hi-IN' },
  { code: 'mai', name: 'Maithili', speechCode: 'hi-IN' },
  { code: 'mag', name: 'Magahi', speechCode: 'hi-IN' },
  { code: 'bgc', name: 'Haryanvi', speechCode: 'hi-IN' },
  { code: 'mwr', name: 'Marwari', speechCode: 'hi-IN' },
  { code: 'bra', name: 'Braj Bhasha', speechCode: 'hi-IN' },
  { code: 'pa', name: 'Punjabi', speechCode: 'pa-IN' },
  { code: 'gu', name: 'Gujarati', speechCode: 'gu-IN' },
  { code: 'mr', name: 'Marathi', speechCode: 'mr-IN' },
  { code: 'bn', name: 'Bengali', speechCode: 'bn-IN' },
  { code: 'ta', name: 'Tamil', speechCode: 'ta-IN' },
  { code: 'te', name: 'Telugu', speechCode: 'te-IN' },
  { code: 'kn', name: 'Kannada', speechCode: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', speechCode: 'ml-IN' },
  { code: 'or', name: 'Odia', speechCode: 'or-IN' },
  { code: 'as', name: 'Assamese', speechCode: 'hi-IN' }, 
];

// Utility to convert raw PCM16 audio data from Gemini to playable WAV format
const pcmToWav = (pcmData, sampleRate) => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + pcmData.byteLength);
  const view = new DataView(buffer);
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.byteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.byteLength, true);
  const pcmView = new Uint8Array(pcmData);
  for (let i = 0; i < pcmView.length; i++) {
    view.setUint8(44 + i, pcmView[i]);
  }
  return new Blob([view], { type: 'audio/wav' });
};

export default function App() {
  const [sourceLang, setSourceLang] = useState(LANGUAGES[2]); 
  const [targetLang, setTargetLang] = useState(LANGUAGES[0]); 
  
  const [inputText, setInputText] = useState('');
  const [outputChunks, setOutputChunks] = useState([]); 
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [playingChunkId, setPlayingChunkId] = useState(null); 

  // API Key State
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

  const recognitionRef = useRef(null);
  const isRecordingRef = useRef(false);
  const restartFlagRef = useRef(false);
  const audioRef = useRef(null); 
  const ttsAbortControllerRef = useRef(null); 
  const activeTranslationsRef = useRef(0);
  
  // T-Mark tracker: remembers the index up to which we have sent text for translation
  const lastTranslatedIndexRef = useRef(0);

  // Initialize Speech Recognition
  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setInputText((prev) => (prev ? prev + ' ' + finalTranscript : finalTranscript));
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsRecording(false);
        isRecordingRef.current = false;
        if (event.error !== 'no-speech') {
            setError(`Microphone error: ${event.error}`);
        }
      };

      recognitionRef.current.onstart = () => {
        setIsRecording(true);
        isRecordingRef.current = true;
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
        isRecordingRef.current = false;

        // Handle auto-restart if language was changed while recording
        if (restartFlagRef.current) {
            restartFlagRef.current = false;
            try {
                recognitionRef.current.start();
            } catch (err) {
                console.error("Failed to restart after lang change", err);
            }
        }
      };
    } else {
      console.warn("Speech recognition not supported in this browser.");
    }
    
    return () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    }
  }, []);

  // Update speech recognition language when source language changes
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = sourceLang.speechCode;
      if (isRecordingRef.current) {
        restartFlagRef.current = true;
        recognitionRef.current.stop();
      }
    }
  }, [sourceLang.speechCode]);

  // Adjust lastTranslatedIndexRef if user manually clears/deletes the text backward
  useEffect(() => {
    if (inputText.length < lastTranslatedIndexRef.current) {
      lastTranslatedIndexRef.current = inputText.length;
    }
  }, [inputText]);

  const saveApiKey = () => {
    setApiKey(tempApiKey);
    localStorage.setItem('gemini_api_key', tempApiKey);
    setShowApiKeyInput(false);
    setError(null);
  };

  const fallbackToBrowserTTS = (text, langCode, chunkId) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      
      // Delay to avoid browser queue silently dropping the utterance right after a cancel()
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langCode;
        const voices = window.speechSynthesis.getVoices();
        const baseLang = langCode.split('-')[0];
        const matchingVoice = voices.find(v => v.lang === langCode) || voices.find(v => v.lang.startsWith(baseLang));
        if (matchingVoice) utterance.voice = matchingVoice;
        
        utterance.onend = () => {
           // Ensure we only clear the play state if the current playing chunk hasn't changed
           setPlayingChunkId(prev => (prev === chunkId ? null : prev));
        };
        utterance.onerror = (e) => {
           console.error("SpeechSynthesis error:", e);
           setPlayingChunkId(prev => (prev === chunkId ? null : prev));
        };
        
        window.speechSynthesis.speak(utterance);
      }, 50);
    } else {
      setPlayingChunkId(prev => (prev === chunkId ? null : prev));
    }
  };

  const togglePlayChunk = async (chunk) => {
    if (!chunk || !chunk.text) return;

    // Stop any native browser audio immediately when toggling states
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    if (playingChunkId === chunk.id) {
      // Stop Gemini playback
      if (ttsAbortControllerRef.current) ttsAbortControllerRef.current.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      setPlayingChunkId(null);
      return;
    }

    setPlayingChunkId(chunk.id);
    await speakText(chunk.text, targetLang.speechCode, chunk.id);
  };

  const speakText = async (text, langCode, chunkId) => {
    if (!text) return;

    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
    }
    
    const currentAbortController = new AbortController();
    ttsAbortControllerRef.current = currentAbortController;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Kore" 
                }
              }
            }
          }
        }),
        signal: currentAbortController.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API Error ${response.status}`);
      }
      
      const data = await response.json();

      if (currentAbortController.signal.aborted) return;
      
      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      
      if (inlineData && inlineData.data) {
         const base64Data = inlineData.data;
         const binaryString = atob(base64Data);
         const bytes = new Uint8Array(binaryString.length);
         for (let i = 0; i < binaryString.length; i++) {
           bytes[i] = binaryString.charCodeAt(i);
         }
         
         let sampleRate = 24000;
         const mimeMatch = (inlineData.mimeType || '').match(/rate=(\d+)/);
         if (mimeMatch) sampleRate = parseInt(mimeMatch[1], 10);

         const wavBlob = pcmToWav(bytes.buffer, sampleRate);
         const audioUrl = URL.createObjectURL(wavBlob);
         
         const audio = new Audio(audioUrl);
         
         audio.onended = () => {
            URL.revokeObjectURL(audioUrl); 
            if (audioRef.current === audio) {
                audioRef.current = null;
                // Guard: Only unset if we are still focused on this specific chunk
                setPlayingChunkId(prev => (prev === chunkId ? null : prev));
            }
         };

         audio.onerror = () => {
             URL.revokeObjectURL(audioUrl);
             if (audioRef.current === audio) {
                 audioRef.current = null;
                 setPlayingChunkId(prev => (prev === chunkId ? null : prev));
             }
         };
         
         audioRef.current = audio;
         
         audio.play().catch(err => {
             console.error("Audio block:", err);
             // Fallback to browser TTS if audio node playback is blocked by system policies
             fallbackToBrowserTTS(text, langCode, chunkId);
         });

      } else {
         // Fix: If Gemini didn't return valid audio (e.g. Safety filter or formatting issue), force the error fallback
         throw new Error("Missing audio payload from API.");
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("Stale TTS request aborted.");
      } else {
        console.warn("Gemini TTS Error, falling back to browser TTS:", err);
        fallbackToBrowserTTS(text, langCode, chunkId);
      }
    }
  };

  const toggleRecording = () => {
    setError(null);
    if (!recognitionRef.current) {
      setError("Speech recognition is not supported in your browser. Please try Chrome.");
      return;
    }

    if (isRecordingRef.current) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error(err);
        setError("Could not start microphone. Please check permissions.");
      }
    }
  };

  // --- T-MARK LOGIC ---
  const handleTMark = () => {
    const currentLength = inputText.length;
    const chunkToTranslate = inputText.substring(lastTranslatedIndexRef.current).trim();
    
    if (!chunkToTranslate) return;

    // Visual marker appended to input text to show what was processed
    const marker = "\n\n[✓ Sent]\n\n";
    
    setInputText(prev => {
        const before = prev.substring(0, currentLength);
        const after = prev.substring(currentLength);
        return before + marker + after;
    });

    // Update the cursor to track processed text
    lastTranslatedIndexRef.current = currentLength + marker.length;

    // Send the specific chunk to API
    translateChunk(chunkToTranslate, sourceLang, targetLang);
  };

  const translateChunk = async (chunk, fromLang, toLang) => {
    activeTranslationsRef.current += 1;
    setIsTranslating(true);
    setError(null);
    
    const fetchTranslation = async (retries = 3, delay = 1000) => {
      try {
        const modelName = apiKey ? 'gemini-2.5-flash' : 'gemini-2.5-flash-preview-09-2025';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ 
                text: `You are an expert Indian linguist. Translate the following text from ${fromLang.name} to ${toLang.name}. \n\nRules:\n1. If translating to an Indian language/dialect, MUST use its native script (e.g., Devanagari for Hindi/Bhojpuri). Do NOT use English/Latin transliteration.\n2. If translating to a dialect, use the authentic colloquial vocabulary.\n3. Do NOT provide pronunciations, quotes, or explanations.\n4. ONLY output the final translated text.\n\nText to translate: "${chunk}"` 
              }]
            }]
          })
        });

        if (!response.ok) {
          // Attempt to parse the exact Gemini error message for better debugging
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `API Error ${response.status}`);
        }
        
        const data = await response.json();
        const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Translation failed.";
        
        const finalTranslation = translated.replace(/^["'](.*)["']$/, '$1');
        
        // Append the new translation chunk
        setOutputChunks(prev => [...prev, { id: Date.now() + Math.random(), text: finalTranslation }]);

      } catch (err) {
        if (retries > 0) {
          setTimeout(() => fetchTranslation(retries - 1, delay * 2), delay);
        } else {
          setError(`Translation failed: ${err.message}`);
          console.error(err);
        }
      } finally {
        activeTranslationsRef.current -= 1;
        if (activeTranslationsRef.current === 0) {
           setIsTranslating(false);
        }
      }
    };

    await fetchTranslation();
  };

  const swapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    // Reset output and pointers, swap text
    const cleanOutput = outputChunks.map(c => c.text).join('\n\n').replace(/\[✓ Sent\]/g, '').trim();
    setInputText(cleanOutput);
    setOutputChunks([]);
    lastTranslatedIndexRef.current = 0;
  };

  const copyToClipboard = () => {
    const textToCopy = outputChunks.map(c => c.text).join('\n\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
       const textArea = document.createElement("textarea");
       textArea.value = textToCopy;
       document.body.appendChild(textArea);
       textArea.select();
       try {
           document.execCommand('copy');
           setCopied(true);
           setTimeout(() => setCopied(false), 2000);
       } catch (err) {
           console.error('Fallback copy failed', err);
       }
       document.body.removeChild(textArea);
    });
  };

  // Check if there is new un-translated text available
  const hasUnprocessedText = inputText.length > lastTranslatedIndexRef.current && inputText.substring(lastTranslatedIndexRef.current).trim().length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-orange-50 text-gray-800 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col items-center justify-center space-y-2 mb-8 text-center pt-8 relative">
          
          {/* API Key Settings Button */}
          <button 
            onClick={() => {
              setTempApiKey(apiKey);
              setShowApiKeyInput(true);
            }}
            className="absolute top-0 right-0 p-2 text-gray-500 hover:text-teal-700 hover:bg-teal-50 rounded-full transition-colors flex items-center space-x-2"
            title="Configure API Key"
          >
            <Key className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline">API Key</span>
          </button>

          {/* Logo Section */}
          <img 
            src="/logo.png" 
            alt="Bhav Yojak Logo" 
            className="h-32 md:h-40 w-auto object-contain mb-2"
            onError={(e) => {
              // Fallback to text/icon if image fails to load (e.g., in the canvas preview)
              e.target.onerror = null;
              e.target.style.display = 'none';
              document.getElementById('fallback-header').style.display = 'flex';
            }}
          />
          
          {/* Fallback Header (Hidden by default, shows if logo.png is missing) */}
          <div id="fallback-header" className="hidden flex-col items-center">
            <div className="bg-teal-700 p-3 rounded-full shadow-lg text-white mb-2">
              <Globe className="w-8 h-8" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">
              Bhav <span className="text-teal-700">Yojak</span>
            </h1>
            <h2 className="text-lg font-medium text-teal-800 mt-1">भाव योजक</h2>
          </div>

          <p className="text-gray-500 max-w-lg mt-2 font-medium">
            CONNECTING EMOTION THROUGH LANGUAGE
          </p>
          <p className="text-gray-400 text-sm max-w-lg mt-1">
            Speak naturally and explicitly "T-Mark" chunks of text to translate and narrate them.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-center shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mr-3" />
            <p className="text-sm text-red-700 font-medium break-words w-full">{error}</p>
          </div>
        )}

        {/* Translation Container */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden flex flex-col md:flex-row relative">
          
          <button 
            onClick={swapLanguages}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-teal-600 hover:bg-teal-700 text-white p-3 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 hidden md:flex"
            aria-label="Swap Languages"
          >
            <ArrowRightLeft className="w-5 h-5" />
          </button>

          {/* Source Panel */}
          <div className="flex-1 flex flex-col relative group border-b md:border-b-0 md:border-r border-gray-100">
            <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
              <select 
                value={sourceLang.code} 
                onChange={(e) => setSourceLang(LANGUAGES.find(l => l.code === e.target.value))}
                className="bg-transparent text-lg font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-600 rounded-md p-1 cursor-pointer appearance-none"
              >
                {LANGUAGES.map(lang => (
                  <option key={`src-${lang.code}`} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>
            
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Speak continuously in ${sourceLang.name}. When ready, hit "T-Mark" to translate...`}
              className="flex-1 w-full p-6 text-xl bg-transparent resize-none focus:outline-none min-h-[300px]"
              dir="auto"
            />
            
            <div className="p-4 flex justify-between items-center bg-white border-t border-gray-50">
               <button
                  onClick={() => setInputText('')}
                  disabled={!inputText}
                  className="px-3 py-2 text-sm text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors rounded-md hover:bg-red-50"
                  title="Clear input"
                >
                  Clear
                </button>

              <div className="flex items-center space-x-3">
                <button
                  onClick={toggleRecording}
                  className={`p-4 rounded-full shadow-md transition-all duration-300 flex items-center justify-center ${
                    isRecording 
                      ? 'bg-red-500 text-white animate-pulse hover:bg-red-600 scale-105' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={isRecording ? "Stop recording" : "Start speaking"}
                >
                  {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                </button>

                {/* T-MARK BUTTON */}
                <button
                  onClick={handleTMark}
                  disabled={!hasUnprocessedText}
                  className={`px-5 py-3 rounded-full shadow-md transition-all flex items-center justify-center space-x-2 font-bold ${
                    hasUnprocessedText 
                      ? 'bg-teal-600 text-white hover:bg-teal-700 hover:scale-105' 
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                  title="Translate all unmarked text (T-Mark)"
                >
                  <span>T-Mark</span>
                  <SendHorizontal className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Target Panel */}
          <div className="flex-1 flex flex-col relative bg-gray-50/30">
            <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
              <select 
                value={targetLang.code} 
                onChange={(e) => setTargetLang(LANGUAGES.find(l => l.code === e.target.value))}
                className="bg-transparent text-lg font-semibold text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 rounded-md p-1 cursor-pointer appearance-none"
              >
                {LANGUAGES.map(lang => (
                  <option key={`tgt-${lang.code}`} value={lang.code}>{lang.name}</option>
                ))}
              </select>
              
              <div className="flex items-center space-x-3">
                {isTranslating && (
                  <div className="flex items-center text-sm text-teal-600">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1 p-4 sm:p-6 text-xl min-h-[300px] overflow-y-auto space-y-4">
              {outputChunks.length > 0 ? (
                outputChunks.map((chunk) => (
                  <div key={chunk.id} className="group relative bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex gap-4">
                    <p dir="auto" className="text-gray-800 flex-1 whitespace-pre-wrap">{chunk.text}</p>
                    <button
                      onClick={() => togglePlayChunk(chunk)}
                      className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all ${
                        playingChunkId === chunk.id 
                          ? 'bg-teal-100 text-teal-700 animate-pulse' 
                          : 'bg-gray-50 text-gray-400 hover:text-teal-600 hover:bg-teal-50'
                      }`}
                      title={playingChunkId === chunk.id ? "Stop playback" : "Listen to paragraph"}
                    >
                      {playingChunkId === chunk.id ? <Pause className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-gray-400 italic h-full flex items-center justify-center flex-col text-center opacity-70">
                  <p>Hit the "T-Mark" button</p>
                  <p className="text-sm">to send a paragraph for translation.</p>
                </div>
              )}
            </div>
            
            <div className="p-4 flex justify-end items-center border-t border-gray-50">
              <button
                onClick={copyToClipboard}
                disabled={outputChunks.length === 0}
                className={`p-2 rounded-full transition-colors flex items-center ${
                  copied 
                    ? 'text-green-600 bg-green-50' 
                    : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50 disabled:opacity-50'
                }`}
                title="Copy all to clipboard"
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* API Key Modal Overlay */}
        {showApiKeyInput && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
              <h2 className="text-2xl font-bold mb-2 flex items-center text-gray-900">
                <Key className="w-6 h-6 mr-2 text-teal-700" /> 
                API Settings
              </h2>
              <p className="text-gray-500 mb-6 text-sm">
                Enter your Google Gemini API key. <br/><br/>
                <span className="font-semibold text-gray-600">Note:</span> If you are testing this directly inside the Canvas environment, leave this blank to use the environment's default proxy key.
              </p>
              <input
                type="password"
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full p-3 border border-gray-200 rounded-xl mb-6 focus:ring-2 focus:ring-teal-600 focus:border-transparent outline-none transition-all font-mono"
              />
              <div className="flex justify-end space-x-3">
                <button 
                  onClick={() => setShowApiKeyInput(false)} 
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveApiKey} 
                  className="px-5 py-2 bg-teal-600 font-medium text-white rounded-xl shadow-md hover:bg-teal-700 transition-colors"
                >
                  Save Key
                </button>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
                Don't have a key? Get one from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">Google AI Studio</a>.
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
