import React, { useState, useEffect, useRef } from 'react';
import Image from '@/lib/image';
import {
  BookOpen,
  Home,
  PlusCircle,
  Timer,
  User,
  Clock3,
  Music,
  ChevronsLeft,
  GraduationCap,
  Repeat,
  CalendarDays,
  Library,
} from 'lucide-react';
import { useAkLoreAccess } from '@/lib/extensions/aklore/access';
import Link from '@/lib/navigation';
import { usePathname } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { useCourse } from '@/context/CourseContext';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { EchoHeader } from '@/components/shared/EchoWord';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { cn } from '@/lib/utils';
import type { UserProfile } from '@/types';
import { PlaylistList } from './PlaylistList';
import SongPickerGrid from '@/components/music/SongPickerGrid';
import PreviewMiniPlayer from '@/components/music/PreviewMiniPlayer';
import FrameLogo from '@/components/layout/FrameLogo';
import UpdateBadge, { useUpdateAvailable } from '@/components/layout/UpdateBadge';
import GuestLinkBadge from '@/components/layout/GuestLinkBadge';
import { useStoredImage } from '@/hooks/use-stored-image';
import { GmailNavIcon } from '@/components/integrations/GmailPanel';
import { ClassroomNavIcon } from '@/components/integrations/ClassroomIcon';
import { DriveNavIcon } from '@/components/integrations/DriveIcon';
import { useExtensionOn } from '@/lib/extensions/store';
import { YoutubeNavIcon } from '@/components/integrations/YoutubeIcon';
import { tr } from '@/lib/i18n';
import { ChromePattern, useChromePattern } from '@/components/extensions/animaciones/Mosaic';
import { usernameLabel } from '@/lib/enum-labels';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Rutas hijas que también deben marcar esta interfaz como activa
   *  (p. ej. /cursos pertenece a Asignaturas, /playlists a Música). */
  activeFor?: string[];
  /** Rutas hijas que tienen su PROPIO botón en el menú (las playlists): con
   *  ellas abiertas, esta interfaz queda en azul fantasma, no sólida (1.6.6). */
  ghostFor?: string[];
  /** Bloque al que pertenece: entre un bloque y el siguiente va una línea fina. */
  group: number;
}

const navItems: NavItem[] = [
  // Lo de cada día.
  { href: '/', get label() { return tr('Inicio'); }, icon: Home, group: 0 },
  { href: '/temporizador', get label() { return tr('Estudio'); }, icon: Timer, group: 0 },
  { href: '/habitos', get label() { return tr('Hábitos'); }, icon: Repeat, group: 0 },
  // Lo académico.
  { href: '/knowledge', get label() { return tr('Asignaturas'); }, icon: GraduationCap, activeFor: ['/cursos'], group: 1 },
  { href: '/tareas', get label() { return tr('Tareas'); }, icon: BookOpen, group: 1 },
  { href: '/calendario', get label() { return tr('Calendario'); }, icon: CalendarDays, group: 1 },
  // Las herramientas de Google integradas.
  { href: '/youtube', label: 'YouTube', icon: YoutubeNavIcon, group: 2 },
  { href: '/gmail', label: 'Gmail', icon: GmailNavIcon, group: 2 },
  { href: '/classroom', label: 'Classroom', icon: ClassroomNavIcon, group: 2 },
  { href: '/music', get label() { return tr('Música'); }, icon: Music, ghostFor: ['/playlists'], group: 3 },
];

/** Extensión AK Lore (1.7.3): tras Calendario, solo para cuentas del colegio. */
const akLoreItem: NavItem = { href: '/aklore', label: 'AK Lore', icon: Library, group: 1 };

/** Extensión Wire (1.8.0): Drive, con la cuenta conectada en Wire, bajo Classroom. */
const driveItem: NavItem = { href: '/drive', label: 'Drive', icon: DriveNavIcon, group: 2 };

/** Los elementos del menú con los de las extensiones que tocan. */
function menuItems(akLore: boolean, drive: boolean): NavItem[] {
  const items = [...navItems];
  if (akLore) items.splice(items.findIndex((i) => i.href === '/calendario') + 1, 0, akLoreItem);
  if (drive) items.splice(items.findIndex((i) => i.href === '/classroom') + 1, 0, driveItem);
  return items;
}

/**
 * Testigo de sesión de estudio en el sidebar. Gira mientras el cronómetro
 * corre y se queda quieto en pausa: de un vistazo se sabe si el tiempo está
 * contando, sin necesidad de entrar en Estudio. Antes había un triángulo de
 * alerta rojo, que daba a entender un error y no una sesión viva.
 */
function SessionClock({ className, spinning }: { className?: string; spinning: boolean }) {
  return (
    <Clock3
      className={cn(
        'text-primary dark:text-white',
        // Vuelta completa lenta: presencia sin llamar la atención.
        spinning && 'animate-spin [animation-duration:3s]',
        className
      )}
      aria-label={spinning ? tr('Sesión de estudio en curso') : tr('Sesión de estudio en pausa')}
    />
  );
}

export function SidebarContent({
  userProfile,
  onLinkClick,
  showCloseButton = false,
  collapsed = false,
  hostDialogs = true,
}: {
  userProfile: UserProfile | null;
  onLinkClick?: () => void;
  showCloseButton?: boolean;
  collapsed?: boolean;
  /** La barra está montada dos veces (fija y desplegable) y el recuadro
   *  «Nueva playlist» se abre con un estado compartido: solo una de las dos
   *  debe pintarlo, o salen dos recuadros apilados con doble velo. */
  hostDialogs?: boolean;
}) {
  const pathname = usePathname();
  const akLore = useAkLoreAccess(userProfile?.email) === 'allowed';
  const drive = useExtensionOn('frame.wire');
  const items = React.useMemo(() => menuItems(akLore, drive), [akLore, drive]);
  const {
    showAlert,
    isTimerActive,
    toggleSidebarCollapsed,
    // Playlist state

    isCreatePlaylistOpen,
    setCreatePlaylistOpen,
    newPlaylistName: newPlName,
    setNewPlaylistName: setNewPlName,
    mergePlaylistSongs,
    playlists,
    updatePlaylist,
  } = useCourse();

  // State for the new playlist dialog
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [playlistSongSearch, setPlaylistSongSearch] = useState('');

  // Se relee sola: también cuando la foto llega de otro dispositivo.
  const [profileAvatar] = useStoredImage(userProfile ? `profileAvatar_${userProfile.id}` : null);

  /**
   * Añade la canción a la playlist EN EL ACTO. `mergePlaylistSongs` crea la
   * playlist si aún no existe y fusiona si ya existe, así que la primera
   * pulsación del "+" ya deja la playlist guardada: si el usuario cierra el
   * diálogo a medias, no pierde lo que llevaba añadido.
   */
  // El nombre con que se creó al añadir la primera canción: las siguientes van
  // a ESA playlist aunque el nombre se siga editando (antes, «Mi» y luego
  // «Mi mezcla» dejaban dos playlists). El nombre final se aplica al cerrar.
  const createdAs = useRef<string | null>(null);
  const latest = useRef({ name: newPlName, playlists, updatePlaylist });
  latest.current = { name: newPlName, playlists, updatePlaylist };

  const handleAddSongToNewPlaylist = (songId: string) => {
    const name = newPlName.trim();
    if (!name || selectedSongIds.includes(songId)) return;
    const target = createdAs.current ?? name;
    mergePlaylistSongs(target, [songId]);
    createdAs.current = target;
    setSelectedSongIds((prev) => [...prev, songId]);
  };

  // Reset playlist form state when dialog closes
  useEffect(() => {
    if (!isCreatePlaylistOpen) {
      const created = createdAs.current;
      const finalName = latest.current.name.trim();
      if (created && finalName && finalName.toLowerCase() !== created.toLowerCase()) {
        const playlist = latest.current.playlists.find((p) => p.name.trim().toLowerCase() === created.toLowerCase());
        if (playlist) latest.current.updatePlaylist(playlist.id, { name: finalName });
      }
      createdAs.current = null;
      setNewPlName('');
      setSelectedSongIds([]);
      setPlaylistSongSearch('');
    }
  }, [isCreatePlaylistOpen, setNewPlName]);

  const isSettingsActive = pathname === '/settings';
  const updateAvailable = useUpdateAvailable();
  // Figuras de Animaciones detrás del menú (1.8.0), si el usuario las puso aquí.
  const chromePattern = useChromePattern('lateral');

  return (
    <>
      <div className={cn('flex flex-col flex-1 min-h-0 bg-card h-full', collapsed ? 'p-2' : 'p-4', chromePattern && 'relative isolate')}>
        {chromePattern && <ChromePattern chrome={chromePattern} />}
        {/* Marca: siempre fija arriba, nunca se desplaza.
            `pt-2` al contraerse: el carril pasa de p-4 a p-2 y el logo se
            quedaba pegado al borde superior mientras abajo respiraba el doble.
            Con esto vuelve a haber el mismo aire arriba que hasta la línea.
            1.6.8 (Diego): el margen de seguridad entre cada línea y el carril
            desplazable se reduce a la mitad (16 → 8 px arriba, 24 → 12 px
            abajo): tapaba media fila de la última playlist visible. */}
        <div className="flex-shrink-0">
          <div
            className={cn(
              'relative flex items-center justify-center pb-4 mb-2 border-b',
              collapsed && 'pt-2'
            )}
          >
            <div className={cn('flex items-center', !collapsed && 'gap-5')}>
              {/* El logo contrae/expande el sidebar */}
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title={collapsed ? tr('Expandir menú') : tr('Contraer menú')}
                className="h-10 w-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FrameLogo className="h-8 w-8" />
              </button>
              {!collapsed && <h1 className="select-none text-xl font-bold text-foreground">{tr('FRAME')}</h1>}
            </div>
            {!collapsed && showCloseButton && onLinkClick && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onLinkClick}
                className="absolute right-0 h-8 w-8"
              >
                <ChevronsLeft className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------------
            Carril desplazable: navegación + playlists. Antes todo esto era
            `flex-shrink-0`, así que al crear varias playlists la columna
            crecía más que la ventana y el desbordamiento salía por la app
            entera —de ahí la barra gigante en el borde derecho—. Ahora el
            scroll vive AQUÍ dentro y la barra se oculta (`hide-scrollbar`):
            la rueda del ratón desplaza el menú sin que se vea nada.
            ------------------------------------------------------------------ */}
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
          <nav className="flex flex-col gap-1">
            {items.map((item, itemIndex) => {
              const newGroup = itemIndex > 0 && items[itemIndex - 1].group !== item.group;
              // Normalizamos ambas rutas para ignorar la barra diagonal final (trailing slash)
              // Esto garantiza que /tareas coincida con /tareas/
              const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
              const normalizedHref = item.href === '/' ? '/' : item.href.replace(/\/$/, '');
              // Una interfaz está activa en su ruta propia Y en sus rutas hijas:
              // así el sidebar siempre refleja la rama en la que está el usuario.
              const matchesRoute = (route: string) =>
                route === '/'
                  ? normalizedPath === '/'
                  : normalizedPath === route || normalizedPath.startsWith(`${route}/`);
              const isActive =
                matchesRoute(normalizedHref) || (item.activeFor ?? []).some(matchesRoute);
              const isGhost = !isActive && (item.ghostFor ?? []).some(matchesRoute);

              const Icon = item.icon;
              const showTimerAlert = item.href === '/temporizador' && showAlert;

              return (
                <React.Fragment key={item.href}>
                  {/* Línea fina entre un bloque y el siguiente. */}
                  {newGroup && <Separator className="my-2" />}
                  <Button
                    variant={isActive ? 'default' : isGhost ? 'fantasma' : 'ghost'}
                    className={cn('text-xs', collapsed ? 'justify-center px-0' : 'justify-start gap-3')}
                    asChild
                  >
                    <Link href={item.href} onClick={onLinkClick} title={collapsed ? item.label : undefined}>
                      <Icon className={cn('h-4 w-4', !isActive && 'text-primary')} />
                      {!collapsed && (
                        <>
                          <span>{item.label}</span>
                          <div className="flex-grow" />
                          {showTimerAlert && <SessionClock className="h-4 w-4" spinning={isTimerActive} />}
                        </>
                      )}
                      {collapsed && showTimerAlert && (
                        <SessionClock
                          className="absolute right-1 top-1 h-3 w-3"
                          spinning={isTimerActive}
                        />
                      )}
                    </Link>
                  </Button>
                </React.Fragment>
              );
            })}
          </nav>

          {/* Las playlists también existen con el carril contraído: son parte
              de la navegación, no un adorno del modo ancho. Contraídas se
              muestran como iconos, igual que el resto de interfaces. */}
          <Button
            variant="ghost"
            className={cn(
              'text-xs mt-2 w-full text-muted-foreground',
              collapsed ? 'justify-center px-0' : 'justify-start gap-3'
            )}
            onClick={() => setCreatePlaylistOpen(true)}
            title={collapsed ? tr('Añadir playlist') : undefined}
          >
            <PlusCircle className="h-4 w-4 text-primary" />
            {!collapsed && <span>{tr('Añadir playlist')}</span>}
          </Button>
          <PlaylistList collapsed={collapsed} />
        </div>

        {/* Pie: 4 + 8 px de aire sobre la línea (antes 16 + 8). */}
        <div className="flex-shrink-0 pt-1">
          <Separator className="my-2" />
          {/* El testigo va FUERA del <Link>, no dentro: un botón anidado en un
              enlace obliga a cancelar el evento para no navegar, y esa
              cancelación hacía que Radix descartara la apertura del popover
              (además de ser HTML inválido). Ahora son hermanos. */}
          <div className="relative">
            <Button
              variant={isSettingsActive ? 'secondary' : 'ghost'}
              className={cn('w-full h-auto p-2', collapsed ? 'justify-center' : 'justify-start')}
              asChild
            >
              <Link href="/settings" onClick={onLinkClick} title={collapsed ? (userProfile?.username ?? tr('Perfil')) : undefined}>
                <div className={cn('flex w-full items-center', !collapsed && 'gap-3')}>
                  {profileAvatar ? (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary overflow-hidden">
                      <Image src={profileAvatar} alt={tr('Foto de perfil')} width={20} height={20} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <User className="h-5 w-5 text-primary" />
                  )}
                  {!collapsed && (
                    <span className="text-xs font-medium text-foreground">{usernameLabel(userProfile?.username)}</span>
                  )}
                </div>
              </Link>
            </Button>

            <div
              className={cn(
                'absolute',
                collapsed ? 'right-0.5 top-0.5' : 'right-2 top-1/2 -translate-y-1/2'
              )}
            >
              {/* Con una versión nueva, manda el testigo de actualizar; si no,
                  el invitado ve aquí la «G» para vincular su cuenta. */}
              {updateAvailable ? (
                <UpdateBadge collapsed={collapsed} />
              ) : (
                userProfile && <GuestLinkBadge userProfile={userProfile} collapsed={collapsed} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------
          Nueva playlist. Rejilla de dos columnas con portadas: la portada es
          el botón de escucha (para reconocer la canción) y el "+" la añade en
          el acto, sin esperar a pulsar "Crear" al final.
          ------------------------------------------------------------------ */}
      <Dialog open={hostDialogs && isCreatePlaylistOpen} onOpenChange={setCreatePlaylistOpen}>
        <DialogContent className="max-w-2xl">
          <EchoHeader word={tr('Playlist')}>
            <DialogHeader>
              <DialogTitle className="text-xl text-primary font-bold text-center">{tr('Nueva playlist')}</DialogTitle>
            </DialogHeader>
          </EchoHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="playlistName" className="text-xs">{tr('Nombre de la playlist')}</Label>
              <Input
                id="playlistName"
                value={newPlName}
                onChange={(e) => setNewPlName(e.target.value)}
                placeholder={tr('Ej: Mi mezcla de entrenamiento')}
                className="border-primary focus-visible:ring-primary"
              />
            </div>

            <SongPickerGrid
              selectedIds={selectedSongIds}
              onAdd={handleAddSongToNewPlaylist}
              search={playlistSongSearch}
              onSearchChange={setPlaylistSongSearch}
              disabledReason={
                newPlName.trim()
                  ? undefined
                  : tr('Ponle nombre a la playlist para empezar a añadir canciones.')
              }
            />
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between sm:space-x-0">
            {/* Lo que suena en la escucha previa: portada, barra para moverse y pausa. */}
            <PreviewMiniPlayer className="w-full sm:w-auto sm:flex-1" />
            <div className="flex shrink-0 items-center gap-3">
              <p className="text-[11px] text-muted-foreground">
                {selectedSongIds.length === 0
                  ? tr('Ninguna canción añadida todavía')
                  : `${selectedSongIds.length} ${selectedSongIds.length === 1 ? tr('canción añadida') : tr('canciones añadidas')}`}
              </p>
              <Button onClick={() => setCreatePlaylistOpen(false)} disabled={selectedSongIds.length === 0}>
                {tr('Listo')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
