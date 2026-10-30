import { useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';

type Shot = { url: string; date: string };
const KEY = 'duelfit-progress-photos';
function readShots(): { before: Shot | null; after: Shot | null } {
  try { return { before: null, after: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { before: null, after: null }; }
}
const service = import.meta.env.VITE_PLATFORM_SERVICES_URL;
const auth = { Authorization: 'Bearer ' + import.meta.env.VITE_PLATFORM_SERVICE_TOKEN };
async function post(path: string, body: unknown) {
  if (!service || !import.meta.env.VITE_PLATFORM_SERVICE_TOKEN) throw new Error('امکان بارگذاری عکس در حال حاضر در دسترس نیست.');
  const response = await fetch(service + path, { method: 'POST', headers: { ...auth, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  if (!response.ok) throw new Error(response.status === 413 ? 'حجم عکس بیشتر از حد مجاز است.' : response.status === 403 ? 'فضای بارگذاری در دسترس نیست.' : 'بارگذاری انجام نشد؛ دوباره تلاش کن.');
  return response.json();
}
export default function ProgressPhotos() {
  const [shots, setShots] = useState(readShots);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const update = (next: typeof shots) => { localStorage.setItem(KEY, JSON.stringify(next)); setShots(next); };
  const upload = async (file: File | undefined, slot: 'before'|'after') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage('فقط عکس انتخاب کن.'); return; }
    if (file.size > 25 * 1024 * 1024) { setMessage('حجم عکس باید کمتر از ۲۵ مگابایت باشد.'); return; }
    setBusy(true); setMessage('عکس در حال بارگذاری است…');
    try {
      const { uploadId, uploadUrl, headers } = await post('/storage/upload-url', { size:file.size, contentType:file.type, name:file.name });
      const sent = await fetch(uploadUrl, { method:'PUT', headers, body:file });
      if (!sent.ok) throw new Error('ارسال عکس انجام نشد.');
      const { url } = await post('/storage/commit', { uploadId, name:file.name });
      const old = shots[slot];
      update({ ...shots, [slot]: { url, date:new Date().toISOString().slice(0,10) } });
      if (old) void post('/storage/delete', { url:old.url }).catch(() => {});
      setMessage('عکس ثبت شد. برای مقایسه، هر دو عکس را با فاصله و نور مشابه بگیر.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'بارگذاری انجام نشد.'); }
    finally { setBusy(false); }
  };
  const remove = async (slot: 'before'|'after') => {
    const old = shots[slot]; if (!old) return;
    setBusy(true);
    try { await post('/storage/delete', { url:old.url }); update({ ...shots, [slot]:null }); setMessage('عکس حذف شد.'); }
    catch { setMessage('حذف عکس انجام نشد؛ دوباره تلاش کن.'); }
    finally { setBusy(false); }
  };
  return <section className="surface-card progress-photos"><div className="card-title"><span className="side-icon"><Camera size={20}/></span><div><h2>تغییر من</h2><p>عکس‌های قبل و بعد را کنار هم مقایسه کن</p></div></div><div className="photo-grid">{(['before','after'] as const).map(slot => <div className="photo-slot" key={slot}><strong>{slot === 'before' ? 'شروع دوره' : 'بعد از دوره'}</strong>{shots[slot] ? <><img src={shots[slot]!.url} alt={slot === 'before' ? 'عکس شروع دوره' : 'عکس پایان دوره'} data-testid={`photo-${slot}`}/><small>{new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium'}).format(new Date(shots[slot]!.date+'T12:00:00'))}</small><button data-testid={`photo-delete-${slot}`} disabled={busy} className="delete-link" onClick={()=>void remove(slot)}><Trash2 size={15}/> حذف عکس</button></> : <div className="photo-empty"><ImagePlus size={32}/><span>{slot === 'before' ? 'عکس شروع را انتخاب کن' : 'وقتی دوره تمام شد، عکس بعدی را اضافه کن'}</span></div>}<label className="photo-upload">{shots[slot] ? 'تعویض عکس' : 'انتخاب یا گرفتن عکس'}<input data-testid={`photo-upload-${slot}`} type="file" accept="image/*" disabled={busy} onChange={e=>{void upload(e.target.files?.[0],slot);e.target.value='';}}/></label></div>)}</div><p className="muted" data-testid="photo-status">{message || (shots.before && shots.after ? 'عکس‌ها کنار هم آمادهٔ مقایسه‌اند؛ تغییر ظاهری از روی دو عکس به‌صورت عددی اندازه‌گیری نمی‌شود.' : 'عکس‌های انتخاب‌شده فقط با خواست تو بارگذاری می‌شوند؛ نتیجهٔ خودکار یا درصد تغییر ساختگی نمایش داده نمی‌شود.')}</p></section>;
}
