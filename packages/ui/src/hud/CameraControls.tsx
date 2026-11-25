import { useEffect, useState } from 'react';
import { cameraCommand, type CameraAngle } from '../core/cinema.ts';
import { useNaos, useView } from '../store/store.ts';

export function CameraControls() {
  const ready = useNaos((s) => s.scene.mounted);
  const camera = useNaos((s) => s.scene.camera);
  const sky = useView((v) => v.sky);
  const level = useView((v) => v.level);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  if (!ready || sky) return null;
  const angles: Array<[CameraAngle, string]> = [['home', level === 'system' ? 'Home' : 'Orbit'], ['atlas', 'Atlas'], ['horizon', 'Horizon']];
  return <div className="camera-controls" aria-label="Camera views">
    <span className="camera-label">CAMERA</span>
    <div role="group" aria-label="Camera angle">{angles.map(([angle, label]) => <button type="button" key={angle} data-angle={angle}
      aria-pressed={camera?.angle === angle && !camera.touring} onClick={() => cameraCommand({ type: 'angle', angle })}>{label}</button>)}</div>
    <button type="button" data-tour="orbit" aria-pressed={camera?.touring ?? false} disabled={reduced}
      title={reduced ? 'Orbit tours follow your reduced-motion preference.' : 'A slow orbit of this view. Any camera input stops it.'}
      onClick={() => cameraCommand({ type: 'tour', enabled: !camera?.touring })}>{camera?.touring ? '■ Stop tour' : '▷ Orbit tour'}</button>
    {level === 'system' ? <button type="button" data-tour="system" disabled={reduced || !!camera?.touring}
      title="A guided flight from the system overview to its project worlds. Any camera input stops it."
      onClick={() => cameraCommand({ type: 'journey' })}>System tour</button> : null}
  </div>;
}
