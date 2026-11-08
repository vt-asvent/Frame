import { Navigate } from 'react-router-dom';
import MusicAdd from '@/components/extensions/MusicAdd';
import { useContributions } from '@/lib/extensions/store';

/** Música → «+ Añadir» (1.9.0): la página de la fuente de música que Frame sabe manejar. Sin ella, a Música. */
export default function MusicAddPage() {
  const source = useContributions('musicSource').find((item) => item.value.engine);
  if (!source) return <Navigate to="/music" replace />;
  return <MusicAdd id={source.id} manifest={source.manifest} source={source.value} />;
}
