import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, RotateCcw, SwitchCamera, X } from 'lucide-react';

/**
 * A camera inside the app, for showing the assistant your homework. The file
 * picker's "take photo" hands you to the phone's camera app and back, which
 * loses your place and sometimes the photo. This is a live viewfinder right
 * here: point, tap, check it, send.
 */
export default function CameraCapture({ open, onClose, onPhoto }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [facing, setFacing] = useState('environment');
  const [shot, setShot] = useState(null);       // data URL of the photo being checked
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || shot) return undefined;
    let dead = false;
    setError('');
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
        });
        if (dead) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      } catch (e) {
        setError(e?.name === 'NotAllowedError'
          ? 'Camera access is blocked. Allow it for LOCK IN!, then try again.'
          : 'No camera could be opened here. Use the paperclip to pick a photo instead.');
      }
    })();
    return () => { dead = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, [open, facing, shot]);

  useEffect(() => { if (!open) setShot(null); }, [open]);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // big enough to read handwriting, small enough to send quickly
    const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL('image/jpeg', 0.85));
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Take a photo">
      <div className="flex items-center justify-between px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] text-white">
        <button type="button" onClick={onClose} aria-label="Close the camera" className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10"><X className="h-6 w-6" /></button>
        <p className="text-sm font-medium">{shot ? 'Use this photo?' : 'Fit the page in the frame'}</p>
        {!shot
          ? <button type="button" onClick={() => setFacing(f => (f === 'environment' ? 'user' : 'environment'))} aria-label="Switch camera" className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10"><SwitchCamera className="h-6 w-6" /></button>
          : <span className="w-11" />}
      </div>
      <div className="relative min-h-0 flex-1">
        {shot
          ? <img src={shot} alt="The photo you took" className="absolute inset-0 h-full w-full object-contain" />
          : <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-contain" />}
        {error && <p className="absolute inset-x-6 top-1/3 rounded-xl bg-white/10 p-4 text-center text-sm text-white">{error}</p>}
      </div>
      <div className="flex items-center justify-center gap-10 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5">
        {shot ? (
          <>
            <button type="button" onClick={() => setShot(null)} className="flex flex-col items-center gap-1 text-xs text-white"><span className="grid h-14 w-14 place-items-center rounded-full bg-white/15"><RotateCcw className="h-6 w-6" /></span>Retake</button>
            <button type="button" onClick={() => { onPhoto(shot); onClose(); }} className="flex flex-col items-center gap-1 text-xs text-white"><span className="grid h-14 w-14 place-items-center rounded-full bg-indigo-600"><Check className="h-7 w-7" /></span>Use photo</button>
          </>
        ) : (
          <button type="button" onClick={snap} disabled={!!error} aria-label="Take the photo"
            className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-4 border-white disabled:opacity-40">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-black"><Camera className="h-6 w-6" /></span>
          </button>
        )}
      </div>
    </div>
  );
}
