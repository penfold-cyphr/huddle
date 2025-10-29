import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Lock,
  Unlock,
  Mic,
  Square,
  Play,
  Pause,
  List,
  Lightbulb,
  FileText,
  X,
  Shield,
  Loader2,
  BrainCircuit, // Keeping BrainCircuit for general use
  Target, // Using Target for AuthScreen
  Clock,
  Send,
  ChevronRight,
  AlertCircle,
  Link
} from 'lucide-react';

// --- Gemini API Call ---
// Handled by backend now

/**
 * Calls OUR backend API endpoint to get AI insights for a huddle.
 * @param {string} text - The user's huddle text.
 * @returns {Promise<object>} - A promise that resolves to the structured insight object.
 */
const getAiInsights = async (text) => {
  try {
    const backendUrl = '/api/analyze';

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });

    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch(e) {
            errorData = { error: `Server responded with status: ${response.status}`};
        }
      throw new Error(errorData.error || `Server responded with status: ${response.status}`);
    }

    const result = await response.json();
    if (result && result.emotions && result.themes && result.insight) {
       return result;
    } else {
        console.error("Backend returned unexpected structure:", result);
        throw new Error("Received invalid analysis structure from server.");
    }

  } catch (error) {
    console.error("Error fetching insights from backend:", error);
    return {
      emotions: ["Error"],
      themes: ["Analysis Unavailable"],
      insight: `Could not get analysis: ${error.message}. Check connection or server status.`
    };
  }
};


// --- Audio Recording Hook with Speech Recognition ---

/**
 * Custom hook for managing audio recording with speech-to-text.
 */
const useAudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);

  // Refs for hardware and timers
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);

  // Ref to mirror state and prevent stale closures in callbacks
  const isRecordingRef = useRef(isRecording);

  // Sync ref with state
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);


  // Initialize speech recognition ONCE
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptPart = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcriptPart + ' ';
          }
        }

        // Append final results to the transcript
        if (finalTranscript) {
          setTranscript(prev => (prev + finalTranscript).trim() + ' ');
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech' || event.error === 'audio-capture') return; // Ignore common, recoverable errors
        alert(`Speech recognition error: ${event.error}. Listening might stop.`);
        setIsListening(false); // Stop listening indicator on critical errors
      };

      recognitionRef.current.onend = () => {
        // CRITICAL FIX: Check the ref, not the stale state, to prevent zombie restarts
        if (isRecordingRef.current) {
          // Only restart if we are *supposed* to be recording
          try {
             if (recognitionRef.current) { // Ensure ref still exists
                recognitionRef.current.start(); // Restart if still recording
             }
          } catch (e) {
            // Avoid error if start() is called when already started (can happen on quick stops/starts)
             if (e.name !== 'InvalidStateError') {
                 console.error("Speech rec restart error", e);
             }
          }
        } else {
          setIsListening(false); // Officially stop listening only if recording stopped
        }
      };
    } else {
        console.warn("Speech Recognition API not supported in this browser.");
    }

    // Main cleanup function for the hook
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.abort(); // Use abort for immediate stop
        } catch (e) {
             console.warn("Error aborting speech recognition:", e);
        }
        recognitionRef.current = null; // Clean up ref
      }
    };
  }, []); // Empty dependency array, runs ONCE.

  const startRecording = async () => {
     if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is not supported or blocked in this browser.");
        return;
     }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      console.error("Failed to get microphone stream:", err);
       if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
           alert("Microphone permission denied. Please allow microphone access in your browser settings.");
       } else {
           alert("Could not start recording. Please ensure microphone access is allowed and your microphone is working.");
       }
      return;
    }

    setIsRecording(true);
    setAudioBlob(null);
    setAudioUrl(null);
    setTranscript('');
    audioChunksRef.current = [];

    // Start MediaRecorder
    let mimeType = 'audio/webm'; // Prefer webm
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4'; // Fallback to mp4
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            console.warn("Neither webm nor mp4 is supported for recording. Audio file might not save correctly.");
            // Potentially add 'audio/ogg' or others if needed
            mimeType = ''; // Let the browser decide if none are supported explicitly
        }
    }

    try {
        const recorderOptions = mimeType ? { mimeType } : {};
        const recorder = new MediaRecorder(streamRef.current, recorderOptions);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) { // Ensure there's data
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onerror = (event) => {
            console.error("MediaRecorder error:", event.error);
        };

        recorder.start();
    } catch (e) {
        console.error("Failed to create MediaRecorder:", e);
        alert("Audio recording failed to initialize. Your browser might not support the required features.");
        // Clean up stream if recorder failed
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setIsRecording(false);
        return;
    }


    // Start speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
         // Avoid error if start() is called when already started
         if (e.name !== 'InvalidStateError') {
             console.error("Speech recognition start error:", e);
             setIsListening(false); // Ensure listening state is correct
         } else {
             setIsListening(true); // Already started, so it *is* listening
         }
      }
    } else {
        console.warn("Speech Recognition not initialized.");
    }

    // Start timer
    setElapsedTime(0);
    clearInterval(timerIntervalRef.current); // Clear any existing timer
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
  };

  const stopRecording = (onStopCallback) => {
    if (!isRecordingRef.current) return; // Check ref

    // CRITICAL FIX: Set state and ref to false *before* stopping hardware
    setIsRecording(false); // Will trigger useEffect to update ref
    // isRecordingRef.current = false; // Done by useEffect

    // Stop speech recognition (this will trigger onend, which will see ref=false)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop(); // Let it stop naturally to finalize transcript
      } catch (e) {
        console.warn("Speech recognition stop error:", e);
      }
      // isListening state is set in the onend handler now
    }

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
       // We need to wait for onstop to fire to get the blob
       mediaRecorderRef.current.onstop = () => {
        let finalMimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(finalMimeType)) finalMimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(finalMimeType)) finalMimeType = ''; // Fallback

        if (audioChunksRef.current.length > 0) {
            const blobOptions = finalMimeType ? { type: finalMimeType } : {};
            const blob = new Blob(audioChunksRef.current, blobOptions);
            const url = URL.createObjectURL(blob);
            setAudioBlob(blob);
            setAudioUrl(url);

            // Now call the callback with the generated URL
            if (onStopCallback) {
              onStopCallback(url);
            }
        } else {
             console.warn("No audio data recorded.");
             if (onStopCallback) {
                 onStopCallback(null); // Indicate no audio URL
             }
        }
        audioChunksRef.current = []; // Clear chunks after processing
      };
       try {
           mediaRecorderRef.current.stop();
       } catch (e) {
            console.error("Error stopping MediaRecorder:", e);
            // Manually trigger onstop logic if stop fails? Risky.
            if (onStopCallback) onStopCallback(null); // Indicate failure
       }
    } else {
        // If recorder wasn't running or doesn't exist, still call callback
         if (onStopCallback) onStopCallback(null);
    }

    // Stop stream and timer
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
  };

  const resetRecording = () => {
    // Ensure recording is stopped first
    if (isRecordingRef.current) {
        stopRecording(() => {
            // Clear state after stopping is complete
            setAudioBlob(null);
            setAudioUrl(null);
            setElapsedTime(0);
            setTranscript('');
            setIsListening(false);
        });
    } else {
        // If already stopped, just clear state
        setAudioBlob(null);
        setAudioUrl(null);
        setElapsedTime(0);
        setTranscript('');
        setIsListening(false);
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch(e) {}
        }
    }
  };

  return {
    isRecording,
    elapsedTime,
    audioUrl,
    transcript,
    isListening,
    startRecording,
    stopRecording,
    resetRecording,
  };
};

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// --- React Components (Monotone Sans-Serif Style) ---

const GlobalStyles = () => {
  useEffect(() => {
    // Import Open Sans font
    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap'; // Updated Font
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

     // Cleanup function
     return () => {
        document.head.removeChild(fontLink);
    };
  }, []);
  return null;
};

/**
 * 1. AuthScreen
 * Updated icon and text for athlete/coach focus
 */
const AuthScreen = ({ onUnlock, isAuthenticating }) => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-white text-black p-8 font-sans">
    <div className="max-w-md w-full text-center">
      {/* Changed Icon */}
      <div className="w-16 h-16 bg-blue-600 mx-auto mb-16 rounded-full flex items-center justify-center">
         <Target size={32} className="text-white"/>
      </div>
      <h1 className="text-4xl font-bold uppercase tracking-wider">
        The Huddle
      </h1>
      {/* Updated Subtext */}
      <p className="mt-4 text-lg font-normal text-gray-600">
        Your Private Log for Performance & Mindset
      </p>

       <div className="mt-12 text-gray-500 text-sm space-y-2">
           <p>✓ No Account Needed</p>
           <p>✓ Data Stays On Your Device</p>
           <p>✓ 100% Confidential</p>
       </div>

      <button
        onClick={onUnlock}
        disabled={isAuthenticating}
        className="mt-12 w-full bg-blue-600 text-white px-12 py-4 text-base font-bold uppercase tracking-wider hover:bg-blue-700 disabled:bg-gray-400 transition-colors rounded"
      >
        {isAuthenticating ? (
          <span className="flex items-center justify-center gap-3">
            <Loader2 size={20} className="animate-spin" />
            Requesting Access...
          </span>
        ) : (
          "Unlock & Grant Mic Access"
        )}
      </button>
      <p className="mt-4 text-xs text-gray-500">
        Microphone access required for voice huddles.
      </p>
    </div>
  </div>
);

/**
 * 2. BottomNavBar
 * Renamed "Debrief" to "Huddle"
 */
const BottomNavBar = ({ activePage, setPage, onShowPrivacy }) => {
  const NavItem = ({ icon, label, page }) => (
    <button
      onClick={() => setPage(page)}
      className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${activePage === page ? 'text-blue-600' : 'text-gray-500 hover:text-black'}`}
    >
      {React.cloneElement(icon, { size: 24, strokeWidth: activePage === page ? 2.5 : 2 })}
      <span className="text-[11px] mt-1 font-semibold uppercase tracking-wide">{label}</span>
    </button>
  );

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-gray-200 shadow-up">
      <div className="max-w-4xl mx-auto h-20 flex">
        <NavItem icon={<Mic />} label="Huddle" page="huddle" /> {/* Renamed */}
        <NavItem icon={<List />} label="History" page="history" />
        <NavItem icon={<Lightbulb />} label="Prompts" page="prompts" />
        <button
          onClick={onShowPrivacy}
          className="flex flex-col items-center justify-center flex-1 h-full transition-colors text-gray-500 hover:text-black"
        >
          <Shield size={24} strokeWidth={2} />
          <span className="text-[11px] mt-1 font-semibold uppercase tracking-wide">Privacy</span>
        </button>
      </div>
    </footer>
  );
};

/**
 * 3. RecordingScreen (Now HuddleScreen)
 * Renamed component and labels
 * Removed "Huddle Up" heading from idle view
 */
const HuddleScreen = ({ selectedPrompt, setSelectedPrompt, onSave }) => { // Renamed component
  const [view, setView] = useState('idle');
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [modalAudioUrl, setModalAudioUrl] = useState(null);
  const [modalTranscript, setModalTranscript] = useState('');

  const {
    isRecording,
    elapsedTime,
    transcript,
    isListening,
    startRecording,
    stopRecording,
    resetRecording,
  } = useAudioRecorder();

  useEffect(() => {
    if (isRecording) setView('recording');
    else setView('idle');
  }, [isRecording]);

  const handleStart = () => {
    startRecording();
  };

  const handleStop = () => {
    stopRecording((url) => {
      setModalAudioUrl(url);
      setModalTranscript(transcript); // Pass final transcript
      setShowAnalysisModal(true);
    });
  };

  const handleDiscard = () => {
    resetRecording();
    setSelectedPrompt(null);
    setShowAnalysisModal(false);
    setModalAudioUrl(null);
    setModalTranscript('');
  };

  const submitTranscription = async (transcription, audioUrl) => {
    if (transcription.trim().length < 10) {
      alert("Please provide more content for analysis (at least 10 characters).");
      return;
    }

    setShowAnalysisModal(false);
    setView('analyzing');

    const insights = await getAiInsights(transcription);

    // Renamed 'debrief' to 'huddle' in the saved object
    const newHuddle = {
      id: Date.now(),
      date: new Date(),
      type: selectedPrompt ? 'Guided' : 'Vent',
      prompt: selectedPrompt || null,
      content: transcription,
      audioUrl: audioUrl,
      duration: elapsedTime,
      ...insights
    };

    onSave(newHuddle); // Pass the new huddle object
    handleDiscard(); // Reset after successful save
  };

  const renderView = () => {
    switch (view) {
      case 'recording':
        return (
          <div className="min-h-full flex flex-col items-center justify-between">
             <div className="w-full text-center pt-8">
              <div className="flex items-center justify-center gap-3 text-red-600 mb-6 md:mb-12">
                <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
                <span className="text-sm font-semibold uppercase tracking-wider">
                  {isListening ? 'Listening...' : 'Recording Audio'}
                </span>
              </div>
              <h1 className="text-7xl md:text-9xl text-black font-bold tabular-nums leading-none mb-6 md:mb-12 max-w-2xl mx-auto">
                {formatTime(elapsedTime)}
              </h1>
            </div>
             <div className="w-full max-w-2xl mx-auto flex-grow overflow-y-auto bg-white p-4 md:p-6 border border-gray-200 rounded-lg shadow-sm mb-6 md:mb-8 max-h-[40vh] md:max-h-[30vh]">
              {transcript ? (
                <p className="text-base md:text-lg leading-relaxed">{transcript}</p>
              ) : (
                <p className="text-base md:text-lg text-gray-400 italic">Start speaking to transcribe...</p>
              )}
            </div>
            <div className="pb-8 flex-shrink-0">
              <button
                onClick={handleStop}
                className="w-20 h-20 md:w-24 md:h-24 bg-black flex items-center justify-center hover:bg-gray-800 transition-colors rounded-full"
              >
                <Square size={32} md:size={40} fill="white" stroke="white" />
              </button>
            </div>
          </div>
        );
      case 'analyzing':
        return (
          <div className="flex flex-col items-center justify-center h-full p-8 text-black">
            <Loader2 size={64} className="animate-spin text-blue-600" strokeWidth={2} />
            <h2 className="text-3xl font-bold mt-12 uppercase tracking-wider">Analyzing</h2>
            <p className="text-lg text-gray-600 mt-4">This will just take a moment</p>
          </div>
        );
      case 'idle':
      default:
        return (
          // Use min-h-full for flex parent
          <div className="min-h-full flex flex-col">
            {/* REMOVED Huddle Up Heading */}
             {/* Use flex-grow for centering content */}
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 pt-16"> {/* Added top padding */}
              {selectedPrompt ? (
                <div className="max-w-xl w-full mb-8 md:mb-12 bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-4">Guided Prompt</p>
                  <p className="text-xl md:text-2xl text-black font-medium leading-tight mb-8">
                    {selectedPrompt}
                  </p>
                  <button
                    onClick={() => setSelectedPrompt(null)}
                    className="text-sm font-semibold uppercase tracking-wider underline hover:no-underline text-gray-500 hover:text-black"
                  >
                    Clear Prompt
                  </button>
                </div>
              ) : (
                <p className="text-xl md:text-3xl font-medium text-black mb-8 md:mb-12">
                  Ready to start your huddle?
                </p>
              )}
              <button
                onClick={handleStart}
                className="w-28 h-28 md:w-32 md:h-32 bg-blue-600 flex items-center justify-center hover:bg-blue-700 transition-colors group rounded-full shadow-lg"
              >
                <Mic size={48} md:size={56} className="text-white" strokeWidth={2} />
              </button>
              <p className="text-sm text-gray-500 mt-8 uppercase tracking-wider">Tap to Record Your Huddle</p>
            </div>
          </div>
        );
    }
  };

  return (
    // Ensure parent has height for min-h-full to work
    <div className="h-full relative bg-transparent">
      {renderView()}
      {showAnalysisModal && (
        <AnalysisModal
          audioUrl={modalAudioUrl}
          duration={elapsedTime}
          initialTranscript={modalTranscript}
          onClose={handleDiscard}
          onSubmit={submitTranscription}
        />
      )}
    </div>
  );
};

/**
 * 4. AnalysisModal
 * Updated styles and labels
 */
const AnalysisModal = ({ audioUrl, duration, initialTranscript, onClose, onSubmit }) => {
  const [transcription, setTranscription] = useState(initialTranscript);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    // State is set by event listeners now
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnd = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener('ended', handleEnd);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    return () => {
      if (audio) {
        audio.removeEventListener('ended', handleEnd);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
      }
    };
  }, [audioRef]);

  const handleSubmit = async () => {
    setIsAnalyzing(true);
    try {
        await onSubmit(transcription, audioUrl);
    } finally {
        setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white font-sans text-black overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 p-4 md:p-8 border-b border-gray-200">
        <div className="flex justify-between items-start">
          <h2 className="text-2xl md:text-4xl font-bold uppercase tracking-wider">
            Review Huddle {/* Renamed */}
          </h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 hover:bg-gray-100 transition-colors rounded-full"
          >
            <X size={24} md:size={32} strokeWidth={2} />
          </button>
        </div>
      </div>

       {/* Body */}
      <div className="flex-grow p-4 md:p-8 flex flex-col">
        <p className="text-base text-gray-600 mb-4 md:mb-8">
          Review your transcription. Edit below if needed.
        </p>

        {audioUrl && (
          <div className="mb-4 md:mb-8">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2 md:mb-4 text-gray-500">Audio Log</h3>
             <div className="flex items-center gap-3 md:gap-4 p-3 md:p-6 bg-gray-100 rounded">
              <audio ref={audioRef} src={audioUrl} className="hidden" preload="metadata" />
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-10 h-10 md:w-16 md:h-16 flex items-center justify-center bg-black text-white rounded-full hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
              >
                {isPlaying ? <Pause size={18} md:size={24} fill="white" stroke="white" /> : <Play size={18} md:size={24} fill="white" stroke="white" />}
              </button>
              <div className="flex-grow">
                <p className="font-semibold text-sm">Recorded Huddle</p> {/* Renamed */}
                <p className="text-xs text-gray-600 uppercase tracking-wider">{formatTime(duration)}</p>
              </div>
            </div>
          </div>
        )}

        <textarea
          rows={10}
          className="w-full p-3 md:p-6 bg-gray-50 border border-gray-300 rounded text-base leading-relaxed focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 resize-none flex-grow mb-4 md:mb-8"
          placeholder="Your transcription appears here..."
          value={transcription}
          onChange={(e) => setTranscription(e.target.value)}
          disabled={isAnalyzing}
        />

         {/* Footer Button */}
        <div className="mt-auto flex-shrink-0">
          <button
            onClick={handleSubmit}
            disabled={isAnalyzing}
            className="w-full bg-blue-600 text-white px-6 md:px-12 py-3 md:py-4 text-base font-bold uppercase tracking-wider hover:bg-blue-700 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-3 rounded"
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Send size={20} />
                Analyze Huddle {/* Renamed */}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 5. PromptsScreen
 * No changes needed for renaming
 */
const PromptsScreen = ({ setSelectedPrompt, setPage }) => {

  const athletePromptCategories = [ { title: "Mental Game & Anxiety", prompts: [ /*...*/ ] }, { title: "Injury & Recovery", prompts: [ /*...*/ ] } ];
  const coachPromptCategories = [ { title: "Leadership & Tactics", prompts: [ /*...*/ ] }, { title: "Stress & Work-Life", prompts: [ /*...*/ ] } ];
  // Keep prompt data the same as before, only update styles

   athletePromptCategories[0].prompts = [
        "Pre-Game Visualization: Walk through your perfect first 5 minutes. What does it look like, sound like, and feel like?",
        "Post-Loss Vent: The 60-second vent. No filter. Get it all out. What's the immediate, raw emotion? Go.",
        "The 'Yips' Log: Describe the feeling when the anxiety starts. Where is it? What's the thought?",
        "The 'Noise' Log: What's one piece of 'noise'—from media, fans, or social—that's in your head right now? Say it out loud to get it out."
      ];
    athletePromptCategories[1].prompts = [
        "Injury Frustration Vent: How are you feeling about your recovery today? Vent the frustrations.",
        "Rehab Log: Describe today's rehab. Where did you feel pain, and where did you feel progress?",
        "Fear of Re-injury: What's the specific fear you're having about returning? Talk through it.",
        "Disconnected: Feeling separate from the team? Describe that feeling."
      ];
   coachPromptCategories[0].prompts = [
        "Tactical Second-Guess: What's the one substitution or play call you're replaying in your head? Talk through your rationale.",
        "Leadership Log: Which player's body language was 'off' today? What's your plan to connect with them tomorrow?",
        "Post-Win Reflection: What was the critical moment that turned the tide? What call set it up?"
      ];
    coachPromptCategories[1].prompts = [
        "End of Day Vent: What's the one thing you need to get off your chest before you can disconnect?",
        "Boundaries: What's one work-thought you can leave at the office tonight?",
        "Burnout Check: How are your energy levels, really? What's the biggest drain?"
      ];


  const handleSelect = (prompt) => {
    setSelectedPrompt(prompt);
    setPage('huddle'); // Go to huddle screen after selecting prompt
  };

  const PromptList = ({ title, prompts }) => (
    <div className="mb-12">
      <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider mb-4 md:mb-6">{/* font-bold to semibold */}</h3>
      <div className="space-y-px bg-white rounded shadow-sm border border-gray-200 overflow-hidden"> {/* Group prompts in a card */}
        {prompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(prompt)}
            className={`w-full text-left p-4 md:p-6 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors group flex justify-between items-center`}
          >
            <p className="text-base md:text-lg font-medium pr-4 text-black">{prompt}</p>
            <ChevronRight size={18} md:size={20} className="text-gray-400 group-hover:text-black transition-colors flex-shrink-0" strokeWidth={2.5} />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    // Padding now applied by parent
    <div>
      <h2 className="text-4xl md:text-5xl font-bold text-black uppercase tracking-wider mb-8 md:mb-12">
        Prompts
      </h2>
      <h3 className="text-xl md:text-2xl font-bold text-black mb-6 md:mb-4">For Athletes</h3>
      {athletePromptCategories.map(cat => <PromptList key={cat.title} title={cat.title} prompts={cat.prompts} />)}

      <h3 className="text-xl md:text-2xl font-bold text-black mt-12 md:mt-16 mb-6 md:mb-4">For Coaches</h3>
      {coachPromptCategories.map(cat => <PromptList key={cat.title} title={cat.title} prompts={cat.prompts} />)}
    </div>
  );
};

/**
 * 6. HistoryScreen
 * Renamed labels, HuddleCard
 */
const HistoryScreen = ({ huddles }) => { // Renamed prop
  const [selectedHuddle, setSelectedHuddle] = useState(null); // Renamed state

  const { totalHuddles, commonEmotions, commonThemes } = useMemo(() => { // Renamed variable
    const emotionCounts = {};
    const themeCounts = {};

    huddles.forEach(huddle => { // Use huddle
      huddle.emotions?.forEach(e => {
        if(e && typeof e === 'string') {
           emotionCounts[e] = (emotionCounts[e] || 0) + 1;
        }
      });
      huddle.themes?.forEach(t => {
         if(t && typeof t === 'string') {
            themeCounts[t] = (themeCounts[t] || 0) + 1;
         }
      });
    });

    const getTopItems = (counts) => Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name]) => name);

    return {
      totalHuddles: huddles.length, // Renamed
      commonEmotions: getTopItems(emotionCounts),
      commonThemes: getTopItems(themeCounts),
    };
  }, [huddles]); // Depend on huddles

  const sortedHuddles = useMemo(() => { // Renamed
    return [...huddles] // Use huddles
        .filter(d => d.date instanceof Date && !isNaN(d.date))
        .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [huddles]); // Depend on huddles

  return (
    // Padding now applied by parent
    <div>
      <h2 className="text-4xl md:text-5xl font-bold text-black uppercase tracking-wider mb-8 md:mb-12">
        History
      </h2>

      {/* Stats Section - Updated grid for mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 md:mb-16 rounded overflow-hidden">
        <div className="bg-black text-white p-6 md:p-8 rounded">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2 md:mb-4 opacity-70">Total Huddles</p> {/* Renamed */}
          <p className="text-5xl md:text-6xl font-bold">{totalHuddles}</p> {/* Renamed */}
        </div>
        <div className="bg-gray-100 p-6 md:p-8 rounded">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2 md:mb-4 text-gray-500">Top Emotion</p>
          <p className="text-lg md:text-xl font-bold text-black truncate">{commonEmotions.length ? commonEmotions[0] : '--'}</p>
        </div>
        <div className="bg-gray-100 p-6 md:p-8 rounded">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2 md:mb-4 text-gray-500">Top Theme</p>
          <p className="text-lg md:text-xl font-bold text-black truncate">{commonThemes.length ? commonThemes[0] : '--'}</p>
        </div>
      </div>

      {/* Huddle History List */}
      <div className="space-y-2 bg-white rounded shadow-sm border border-gray-200 overflow-hidden">
        {sortedHuddles.length === 0 ? ( // Use renamed variable
          <div className="py-24 md:py-32 text-center bg-white rounded">
            <FileText size={48} className="text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg md:text-xl">Your saved huddles will appear here.</p> {/* Renamed */}
          </div>
        ) : (
          sortedHuddles.map(huddle => ( // Use renamed variable
            <HuddleCard // Renamed component
              key={huddle.id}
              huddle={huddle} // Pass huddle prop
              onClick={() => setSelectedHuddle(huddle)} // Use renamed state setter
            />
          ))
        )}
      </div>

      {selectedHuddle && ( // Use renamed state
        <InsightModal
          huddle={selectedHuddle} // Pass huddle prop
          onClose={() => setSelectedHuddle(null)} // Use renamed state setter
        />
      )}
    </div>
  );
};

// Renamed DebriefCard to HuddleCard
const HuddleCard = ({ huddle, onClick }) => { // Renamed props
  const firstLine = typeof huddle.content === 'string' ? huddle.content.split('\n')[0] : "No transcription available";
  const displayDate = huddle.date instanceof Date && !isNaN(huddle.date)
      ? huddle.date.toLocaleDateString()
      : 'Invalid Date';

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 md:p-6 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors group flex justify-between items-center"
    >
        <div className="flex-grow pr-4 overflow-hidden">
          <span className="text-xs md:text-sm font-bold text-blue-600 uppercase tracking-wider">
            {huddle.type === 'Guided' ? 'Guided Huddle' : 'Free Vent'} {/* Renamed */}
          </span>
          <p className="text-base md:text-lg font-medium text-black truncate my-2">
            {firstLine}
          </p>
           {huddle.type === 'Guided' && huddle.prompt && ( // Check huddle prop
                <p className="text-xs md:text-sm italic text-gray-500 mb-3 truncate">
                Prompt: {huddle.prompt}
                </p>
            )}
          <div className="flex items-center gap-3 md:gap-4 text-gray-500 text-[10px] md:text-xs uppercase tracking-wider mb-3">
            <span>{displayDate}</span>
            <span>{formatTime(huddle.duration || 0)}</span>
            {huddle.audioUrl && <span className="text-black font-semibold">● Audio</span>}
          </div>
          <div className="flex flex-wrap gap-1 md:gap-2">
            {huddle.emotions?.slice(0, 3).map((e, i) => ( // Use huddle prop
               e && typeof e === 'string' &&
              <span key={i} className="px-2 py-0.5 md:px-3 md:py-1 bg-gray-200 text-gray-800 text-[10px] md:text-xs font-medium uppercase tracking-wide rounded-full">
                {e}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-shrink-0">
          <ChevronRight size={18} md:size={20} className="text-gray-400 group-hover:text-black transition-colors" strokeWidth={2.5} />
        </div>
    </button>
  );
};

/**
 * 7. InsightModal
 * Renamed labels, props
 */
const InsightModal = ({ huddle, onClose }) => { // Renamed prop
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
       try { audioRef.current.play(); } catch (e) { console.error("Error playing audio:", e); setIsPlaying(false); }
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    return () => { if (audio) { audio.removeEventListener('play', handlePlay); audio.removeEventListener('pause', handlePause); audio.removeEventListener('ended', handleEnded); } };
  }, [audioRef]);

  const displayDate = huddle.date instanceof Date && !isNaN(huddle.date) // Use huddle prop
        ? huddle.date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : 'Invalid Date';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white font-sans text-black overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 p-6 md:p-8 border-b border-gray-200">
        <div className="flex justify-between items-start">
           <div>
               <h2 className="text-3xl md:text-4xl font-bold uppercase tracking-wider mb-1">
                {huddle.type === 'Guided' ? 'Guided Insight' : 'Insight'} {/* Use huddle prop */}
               </h2>
               <p className="text-sm text-gray-500">{displayDate} - {formatTime(huddle.duration || 0)}</p> {/* Use huddle prop */}
           </div>
          <button onClick={onClose} className="p-2 -mr-2 md:p-2 hover:bg-gray-100 transition-colors rounded-full">
            <X size={28} md:size={32} strokeWidth={2} />
          </button>
        </div>
      </div>

       {/* Body */}
      <div className="flex-grow p-6 md:p-8">
        {/* AI Insight */}
        <div className="bg-blue-600 text-white p-8 md:p-12 mb-8 md:mb-12 rounded">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-4 md:mb-6 opacity-80">
            AI Analysis
          </h3>
          <p className="text-xl md:text-2xl font-normal leading-relaxed">
            {huddle.insight || "No insight available."} {/* Use huddle prop */}
          </p>
        </div>

        {/* Audio Player */}
        {huddle.audioUrl && ( // Use huddle prop
          <div className="mb-8 md:mb-12">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 md:mb-4 text-gray-500">Audio Log</h3>
            <div className="flex items-center gap-4 p-4 md:p-6 bg-gray-100 rounded">
              <audio ref={audioRef} src={huddle.audioUrl} className="hidden" preload="metadata" /> {/* Use huddle prop */}
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-12 h-12 md:w-16 md:h-16 flex items-center justify-center bg-black text-white rounded-full hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
              >
                {isPlaying ? <Pause size={20} md:size={24} fill="white" stroke="white" /> : <Play size={20} md:size={24} fill="white" stroke="white" />}
              </button>
              <div className="flex-grow">
                <p className="font-semibold text-sm md:text-base">Recorded Huddle</p> {/* Renamed */}
                <p className="text-xs md:text-sm text-gray-600 uppercase tracking-wider">{formatTime(huddle.duration || 0)}</p> {/* Use huddle prop */}
              </div>
            </div>
          </div>
        )}

        {/* Emotions & Themes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-8 md:mb-12">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 md:mb-4 text-gray-500">Emotions</h3>
            <div className="flex flex-wrap gap-2">
              {(huddle.emotions && huddle.emotions.length > 0) ? huddle.emotions.map((e, i) => ( // Use huddle prop
                 e && typeof e === 'string' &&
                <span key={i} className="px-3 py-1 md:px-4 md:py-2 bg-gray-200 text-gray-800 text-xs md:text-sm font-medium uppercase tracking-wide rounded-full">
                  {e}
                </span>
              )) : <span className="text-sm text-gray-500 italic">None detected</span>}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 md:mb-4 text-gray-500">Themes</h3>
            <div className="flex flex-wrap gap-2">
               {(huddle.themes && huddle.themes.length > 0) ? huddle.themes.map((t, i) => ( // Use huddle prop
                 t && typeof t === 'string' &&
                <span key={i} className="px-3 py-1 md:px-4 md:py-2 bg-gray-200 text-gray-800 text-xs md:text-sm font-medium uppercase tracking-wide rounded-full">
                  {t}
                </span>
              )) : <span className="text-sm text-gray-500 italic">None detected</span>}
            </div>
          </div>
        </div>

        {/* Full Transcription */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 md:mb-4 text-gray-500">Transcription</h3>
          <div className="max-h-64 overflow-y-auto p-4 md:p-6 bg-gray-50 border-l-4 border-black rounded-r">
            <p className="text-base md:text-lg leading-relaxed whitespace-pre-wrap">
                {huddle.content || <span className="italic text-gray-500">No transcription available.</span>} {/* Use huddle prop */}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 8. PrivacyModal
 * No changes needed for renaming
 */
const PrivacyModal = ({ onClose }) => (
  <div className="fixed inset-0 z-50 flex flex-col bg-white font-sans text-black overflow-y-auto">
     {/* Header */}
    <div className="flex-shrink-0 p-6 md:p-8 border-b border-gray-200">
      <div className="flex justify-between items-start">
        <h2 className="text-3xl md:text-4xl font-bold uppercase tracking-wider">
          The Huddle Pact
        </h2>
        <button onClick={onClose} className="p-2 -mr-2 md:p-2 hover:bg-gray-100 transition-colors rounded-full">
          <X size={28} md:size={32} strokeWidth={2} />
        </button>
      </div>
    </div>

     {/* Body */}
    <div className="flex-grow p-6 md:p-8 space-y-6 md:space-y-8 text-base md:text-lg leading-relaxed">
      <p className="text-xl md:text-2xl font-bold">
        Your privacy is the foundation. Period.
      </p>

      <div className="space-y-5 md:space-y-6 text-gray-700">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-2 md:mb-3 text-black">Device-Only Storage</h3>
          <p>
            Your audio recordings and transcriptions <strong className="text-black font-semibold">stay on your device</strong>. They are never uploaded to our servers unless you explicitly choose a future backup option (which will also be encrypted).
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-2 md:mb-3 text-black">No Personal Info Collected</h3>
          <p>
             We <strong className="text-black font-semibold">do not ask for or store your name, email, phone number, or any other personally identifiable information (PII).</strong> Your usage is anonymous.
          </p>
        </div>
         <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-2 md:mb-3 text-black">Strong Encryption</h3>
          <p>
             Data is encrypted <strong className="text-black font-semibold">at rest (AES-256)</strong> and <strong className="text-black font-semibold">in transit (min TLS 1.2)</strong> if any future cloud features are added.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-2 md:mb-3 text-black">No AI Training on Your Data</h3>
          <p>
            Your private huddles are <strong className="text-black font-semibold">never used to train</strong> the Gemini AI model or any other AI. The analysis is performed on the fly and the result is sent back only to you.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-2 md:mb-3 text-black">No Sharing. No Selling. No Ads.</h3>
          <p>
            Your data or insights are never shared with your team, league, agent, advertisers, or anyone else. <strong className="text-black font-semibold">We will never sell your data or show you ads.</strong>
          </p>
        </div>
        <div className="pt-4 md:pt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-2 md:mb-3 text-yellow-700">Important Disclaimer</h3>
            <p>
               'The Huddle' provides AI-generated insights for reflection. It is <strong className="text-black font-semibold">not a substitute for professional therapy, medical treatment, or mental health care.</strong> The AI cannot detect or diagnose conditions.
            </p>
            <p className="mt-3">
                 If you are in crisis or need immediate support, please contact a qualified professional or use crisis resources.
                 <a href="https://findahelpline.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold ml-2 underline">
                     Find A Helpline <Link size={14} />
                 </a>
            </p>
        </div>
      </div>
      <p className="pt-6 md:pt-8 text-lg md:text-xl font-bold text-black">
        This is your secure space. What's said in here, stays in here.
      </p>
    </div>

    {/* Footer Button */}
    <div className="flex-shrink-0 p-6 md:p-8 border-t border-gray-200">
      <button
        onClick={onClose}
        className="w-full bg-black text-white px-8 md:px-12 py-4 md:py-6 text-base md:text-lg font-bold uppercase tracking-wider hover:bg-gray-800 transition-colors rounded"
      >
        Understood
      </button>
    </div>
  </div>
);

/**
 * --- Main App Component ---
 * Renamed state variables and handlers
 */
export default function App() {
  const [isAuth, setIsAuth] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [page, setPage] = useState('huddle'); // Default to huddle
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [huddles, setHuddles] = useState([]); // Renamed state

  // Load Huddles from Local Storage
   useEffect(() => {
    try {
      const storedHuddles = localStorage.getItem('theHuddles'); // Changed key
      if (storedHuddles) {
          const parsedHuddles = JSON.parse(storedHuddles).map(d => ({ ...d, date: new Date(d.date) }));
          if (Array.isArray(parsedHuddles)) { setHuddles(parsedHuddles); }
          else { localStorage.removeItem('theHuddles'); }
      }
    } catch (e) { console.error("LS Load Error:", e); localStorage.removeItem('theHuddles'); }
  }, []);

  // Save Huddles to Local Storage
   useEffect(() => {
    try {
        // Prevent saving invalid date objects
         const validHuddles = huddles.filter(h => h.date instanceof Date && !isNaN(h.date));
        if (validHuddles.length > 0) { // Check huddles state
             const storableHuddles = validHuddles.map(d => ({ ...d, date: d.date.toISOString() })); // Use huddles state
            localStorage.setItem('theHuddles', JSON.stringify(storableHuddles)); // Changed key
        } else {
             localStorage.removeItem('theHuddles'); // Changed key if array is empty or only contains invalid dates
        }
    } catch (e) { console.error("LS Save Error:", e); alert("Warning: Could not save huddles."); } // Updated message
  }, [huddles]); // Depend on huddles state


  const handleUnlock = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setIsAuth(true);
      setShowPrivacy(true); // Show privacy modal on successful unlock
    } catch (err) {
      console.error("Mic permission error:", err);
       if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') { alert("Mic permission needed."); }
       else { alert("Mic access error."); }
      setIsAuthenticating(false);
    }
  };

  // Renamed handler
  const handleSaveHuddle = (newHuddle) => {
    setHuddles(prev => [newHuddle, ...prev]); // Use huddles state setter
    setPage('history');
  };

  if (!isAuth) {
    return (
      <div className="min-h-screen bg-white font-sans">
        <GlobalStyles />
        <AuthScreen
          onUnlock={handleUnlock}
          isAuthenticating={isAuthenticating}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 text-black font-sans">
      <GlobalStyles />
      <main className="pb-20">
        <div className="container mx-auto max-w-4xl h-[calc(100vh-80px)] overflow-y-auto px-4 md:px-8 py-8">
          {/* Renamed page check and component */}
          {page === 'huddle' && (
            <HuddleScreen
              selectedPrompt={selectedPrompt}
              setSelectedPrompt={setSelectedPrompt}
              onSave={handleSaveHuddle} // Pass renamed handler
            />
          )}
          {page === 'history' && (
            <HistoryScreen
              huddles={huddles} // Pass renamed state
            />
          )}
          {page === 'prompts' && (
            <PromptsScreen
              setSelectedPrompt={setSelectedPrompt}
              setPage={setPage} // Pass setPage to navigate back
            />
          )}
        </div>
      </main>

      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}

      <BottomNavBar
        activePage={page}
        setPage={setPage}
        onShowPrivacy={() => setShowPrivacy(true)}
      />
    </div>
  );
}

