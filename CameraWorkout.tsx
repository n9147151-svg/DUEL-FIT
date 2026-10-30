import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, RotateCcw, X } from 'lucide-react';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-converter';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';

type Mode = 'pushup' | 'curl';
type Point = { x: number; y: number; score?: number; name?: string };
const joint = (points: Point[], name: string) => points.find(p => p.name === name && (p.score ?? 0) > 0.45);
const angle = (a: Point, b: Point, c: Point) => {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  return Math.abs(Math.atan2(Math.sin(ab - cb), Math.cos(ab - cb))) * 180 / Math.PI;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export default function CameraWorkout({ mode, target, onSave, onClose }: { mode: Mode; target?: number; onSave: (count: number) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useRef<'up' | 'down'>('up');
  const lowAnchor = useRef<{ shoulder: number; eyes: number } | null>(null);
  const lastTick = useRef(0);
  const reps = useRef(0);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState('برای شروع، دوربین را روشن کن.');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | undefined;
    let detector: poseDetection.PoseDetector | undefined;
    const start = async () => {
      setLoading(true);
      setCameraReady(false);
      setVisible(false);
      setError('');
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('دوربین در این محیط در دسترس نیست. برنامه را در نسخهٔ نصب‌شده یا صفحهٔ امن باز کن.');
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        } catch (firstError) {
          if (firstError instanceof DOMException && firstError.name === 'OverconstrainedError') {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          } else throw firstError;
        }
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = video.current;
        if (!v) throw new Error('نمای دوربین آماده نشد؛ دوباره تلاش کن.');
        v.srcObject = stream;
        await v.play();
        if (cancelled) return;
        setCameraReady(true);
        setStatus('تصویر دوربین باز شد؛ در حال آماده‌سازی تشخیص حرکت…');
        try {
          await tf.setBackend('webgl');
          await tf.ready();
          detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, enableSmoothing: true });
        } catch (detectionError) {
          console.error('Pose detector initialization failed:', detectionError);
          if (!cancelled) {
            setError('دوربین باز است، اما تشخیص حرکت بارگذاری نشد. اتصال اینترنت را بررسی کن و دوباره تلاش کن؛ تا آن زمان تکراری ثبت نمی‌شود.');
            setLoading(false);
          }
          return;
        }
        if (cancelled) { detector.dispose(); return; }
        setLoading(false);
        setStatus('تمام بدن و هر دو دست را داخل کادر نگه دار.');
        const tick = async (time: number) => {
          if (cancelled || !v.videoWidth || !canvas.current || !detector) return;
          if (time - lastTick.current < 110) { frame = requestAnimationFrame(tick); return; }
          lastTick.current = time;
          try {
            const poses = await detector.estimatePoses(v);
            if (cancelled) return;
            const overlay = canvas.current;
            const ctx = overlay?.getContext('2d');
            if (!ctx || !overlay) return;
            if (overlay.width !== v.videoWidth || overlay.height !== v.videoHeight) { overlay.width = v.videoWidth; overlay.height = v.videoHeight; }
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            const points = (poses[0]?.keypoints || []) as Point[];
            const names = ['left_eye','right_eye','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_hip','right_hip'];
            const p = Object.fromEntries(names.map(n => [n, joint(points, n)])) as Record<string, Point | undefined>;
            const required = mode === 'pushup' ? names : names.slice(2);
            if (required.some(n => !p[n])) { setVisible(false); setStatus('بدن و دست‌ها کامل دیده نمی‌شوند؛ کمی از دوربین فاصله بگیر.'); phase.current = 'up'; lowAnchor.current = null; }
            else {
              setVisible(true);
              const line = (a: Point, b: Point, color: string) => { ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); };
              line(p.left_shoulder!, p.right_shoulder!, '#b9f65e');
              for (const side of ['left','right']) { line(p[`${side}_shoulder`]!,p[`${side}_elbow`]!,'#b9f65e'); line(p[`${side}_elbow`]!,p[`${side}_wrist`]!,'#b9f65e'); }
              for (const eye of ['left_eye','right_eye']) if (p[eye]) { ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(p[eye]!.x,p[eye]!.y,6,0,Math.PI*2); ctx.fill(); }
              const left = angle(p.left_shoulder!,p.left_elbow!,p.left_wrist!);
              const right = angle(p.right_shoulder!,p.right_elbow!,p.right_wrist!);
              const avg = (left + right) / 2;
              const shouldersY = (p.left_shoulder!.y + p.right_shoulder!.y) / 2;
              const eyesY = p.left_eye && p.right_eye ? (p.left_eye.y + p.right_eye.y) / 2 : 0;
              const torso = (distance(p.left_shoulder!,p.left_hip!) + distance(p.right_shoulder!,p.right_hip!)) / 2;
              const bodyStraight = Math.abs(distance(p.left_shoulder!,p.left_hip!) - distance(p.right_shoulder!,p.right_hip!)) < torso * .35;
              if (mode === 'pushup') {
                if (!bodyStraight) setStatus('بدنت را صاف نگه دار؛ این تکرار ثبت نمی‌شود.');
                else if (phase.current === 'up' && avg < 105) { phase.current='down'; lowAnchor.current={ shoulder:shouldersY, eyes:eyesY }; setStatus('حالا با کنترل بالا بیا.'); }
                else if (phase.current === 'down' && avg > 150) {
                  const vertical = (lowAnchor.current!.shoulder - shouldersY) / Math.max(torso, 1);
                  const eyeMovement = (lowAnchor.current!.eyes - eyesY) / Math.max(torso, 1);
                  const eyesFollow = eyeMovement > .08;
                  phase.current='up'; lowAnchor.current=null;
                  if (vertical > .12 && eyesFollow && bodyStraight) { reps.current++; setCount(reps.current); setStatus('این تکرار ثبت شد!'); }
                  else setStatus('حرکت را کامل انجام بده؛ تکرار ناقص بود.');
                }
              } else {
                const stable = Math.abs(p.left_shoulder!.y - p.right_shoulder!.y) < torso * .4;
                if (!stable) setStatus('شانه‌ها را ثابت نگه دار.');
                else if (phase.current === 'up' && avg < 80) { phase.current='down'; setStatus('دمبل‌ها را آرام پایین ببر.'); }
                else if (phase.current === 'down' && avg > 145) { phase.current='up'; reps.current++; setCount(reps.current); setStatus('این تکرار ثبت شد!'); }
              }
            }
          } catch { setStatus('تصویر به‌خوبی تحلیل نشد؛ نور و فاصله را بررسی کن.'); }
          if (!cancelled) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (e) {
        console.error('Camera initialization failed:', e);
        if (!cancelled) {
          const message = e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'دسترسی به دوربین رد شده یا در این محیط مسدود است؛ دسترسی دوربین را در تنظیمات دستگاه یا مرورگر فعال کن.'
            : e instanceof DOMException && e.name === 'NotFoundError'
              ? 'دوربینی در این دستگاه پیدا نشد.'
              : e instanceof DOMException && e.name === 'NotReadableError'
                ? 'دوربین در برنامهٔ دیگری در حال استفاده است؛ آن برنامه را ببند و دوباره تلاش کن.'
                : e instanceof Error ? e.message : 'راه‌اندازی دوربین انجام نشد.';
          setError(message); setRunning(false); setLoading(false); setCameraReady(false);
        }
      }
    };
    void start();
    return () => { cancelled = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(t => t.stop()); detector?.dispose(); if (video.current) video.current.srcObject = null; };
  }, [running, mode]);
  return <div className="modal-backdrop camera-backdrop"><div className="camera-modal" role="dialog" aria-modal="true" aria-label="تمرین با دوربین"><div className="camera-heading"><div><span className="section-kicker">تمرین با دوربین</span><h2>{mode === 'pushup' ? 'شمارش شنا' : 'شمارش جلو بازو دمبل'}</h2></div><button data-testid="camera-close" aria-label="بستن دوربین" onClick={onClose}><X size={22}/></button></div><p className="muted">تصویر روی دستگاه تحلیل می‌شود و عکس یا فیلمی ذخیره نمی‌شود. تشخیص خودکار تقریبی است؛ برای ایمنی به فرم خودت هم توجه کن.</p><div className="camera-stage"><video ref={video} playsInline muted autoPlay/><canvas ref={canvas}/>{!running && !error && <div className="camera-placeholder"><CameraOff size={38}/><span>دوربین خاموش است</span></div>}{loading && !cameraReady && <div className="camera-placeholder"><span>در حال روشن‌کردن دوربین…</span></div>}</div><div className="camera-feedback" data-testid="camera-feedback"><strong data-testid="camera-count">{new Intl.NumberFormat('fa-IR').format(count)}</strong><div><span>تکرار تشخیص‌داده‌شده{target ? ` · هدف ${new Intl.NumberFormat('fa-IR').format(target)}` : ''}</span><p>{error || status}</p></div></div>{running && !loading && !error && !visible && <p className="camera-hint">تا زمانی که نقاط بدن کامل دیده نشوند، شمارش متوقف است.</p>}<div className="camera-actions">{!running ? <button data-testid="camera-start" className="btn-primary" onClick={()=>setRunning(true)}><Camera size={18}/> {error ? 'تلاش دوباره برای دوربین' : 'اجازه و روشن کردن دوربین'}</button> : <button data-testid="camera-stop" className="btn-ghost" onClick={()=>setRunning(false)}><CameraOff size={18}/> {error ? 'توقف و تلاش دوباره' : 'توقف دوربین'}</button>}<button data-testid="camera-reset" className="btn-ghost" onClick={()=>{reps.current=0;setCount(0);phase.current='up';lowAnchor.current=null}}><RotateCcw size={17}/> صفر کردن</button><button data-testid="camera-save" className="btn-primary" disabled={!count} onClick={()=>onSave(count)}><Check size={17}/> تأیید و ثبت {count ? new Intl.NumberFormat('fa-IR').format(count) : ''} تکرار</button></div><p className="muted">برای شنا، چشم‌ها و هر دو شانه و دست باید دیده شوند. برای دمبل، هر دو دست باید هم‌زمان حرکت کنند. ثبت نهایی فقط با تأیید تو انجام می‌شود.</p></div></div>;
}
