import React, { useState, useEffect, useRef, useMemo } from 'react';
import Image from '@/lib/image';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useCourse } from '@/context/CourseContext';
import type { StudyGoals, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  User,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  CalendarDays,
  Copy,
  LoaderCircle,
  ChevronDown,
  Languages,
  Puzzle,
  Info,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { accountCode } from '@/lib/account-code';
import RealNameRow from '@/components/settings/RealNameRow';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme';
import { ACCENTS, customAccent, getAccent, getCustomHex, setAccent, setCustomAccent, type AccentId } from '@/lib/accent';
import ColorPicker from '@/components/settings/ColorPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { saveImage } from '@/lib/music-db';
import { useStoredImage } from '@/hooks/use-stored-image';
import { Dialog, DialogTrigger, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import AvatarCropper from '@/components/auth/AvatarCropper';
import AccountMenu from '@/components/settings/AccountCard';
import { DevicesCard } from '@/components/settings/DevicesCard';
import { useContributions, useExtensionOn, useInstalledExtensions } from '@/lib/extensions/store';
import { ANIMACIONES, effectiveLook, useLook } from '@/lib/extensions/animaciones';
import ProfileStats from '@/components/settings/ProfileStats';
import ReportCenter from '@/components/settings/ReportCenter';
import { APP_VERSION, BUILD_DATE } from '@/lib/version';
import LegalDocument from '@/components/settings/LegalDocument';
import { INFO_VERSION, SUPPORT_VERSION, TERMS_VERSION } from '@/lib/legal/versions';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { updateUsername } from '@/lib/supabase/auth';
import StreakStatusCard from '@/components/settings/StreakStatusCard';
import EchoWord from '@/components/shared/EchoWord';


import { dateLocale, LANG_NAMES, LANGS, setLang, tr, useLang } from '@/lib/i18n';
import { usernameLabel } from '@/lib/enum-labels';

const daysOfWeek: { key: keyof StudyGoals; label: string }[] = [
  { key: 'monday', get label() { return tr('Lunes'); } },
  { key: 'tuesday', get label() { return tr('Martes'); } },
  { key: 'wednesday', get label() { return tr('Miércoles'); } },
  { key: 'thursday', get label() { return tr('Jueves'); } },
  { key: 'friday', get label() { return tr('Viernes'); } },
  { key: 'saturday', get label() { return tr('Sábado'); } },
  { key: 'sunday', get label() { return tr('Domingo'); } },
];

// Idioma de la interfaz (1.6.7): cambia al instante, sin reiniciar. Cada
// idioma se nombra en sí mismo («Español», «English», «日本語»): así quien
// cambió sin querer encuentra el suyo. Con ocho (1.7.3), una lista en vez
// de un botón por idioma; el ícono universal de idiomas ayuda a encontrarla.
function LanguageSelector() {
  const lang = useLang();
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-muted-foreground text-xs">{tr('Idioma')}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            lang={lang}
            className="h-9 gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/20 hover:text-primary"
          >
            <Languages className="h-3.5 w-3.5" aria-hidden />
            {LANG_NAMES[lang]}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[10rem]">
          {LANGS.map((value) => (
            <DropdownMenuCheckboxItem
              key={value}
              lang={value}
              checked={lang === value}
              onCheckedChange={() => void setLang(value)}
              className="text-xs font-medium"
            >
              {LANG_NAMES[value]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Selector de tema de la app: claro (arena) / oscuro / según el dispositivo.
// El cambio es inmediato y persiste entre sesiones (localStorage).
function ThemeSelector() {
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreference());
  const options: { value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'light', label: tr('Tema claro'), icon: Sun },
    { value: 'dark', label: tr('Tema oscuro'), icon: Moon },
    { value: 'system', label: tr('Tema del dispositivo'), icon: Monitor },
  ];
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-muted-foreground text-xs">{tr('Tema')}</p>
      <div className="flex items-center gap-3">
        {options.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant="ghost"
            size="icon"
            title={label}
            className={cn(
              'h-9 w-9 rounded-md border',
              pref === value
                ? 'border-primary/50 bg-primary/10 hover:bg-primary/20'
                : 'border-border bg-transparent hover:bg-secondary'
            )}
            onClick={() => {
              setThemePreference(value);
              setPref(value);
            }}
          >
            <Icon className={cn('h-5 w-5', pref === value ? 'text-primary' : 'text-muted-foreground')} />
          </Button>
        ))}
      </div>
    </div>
  );
}

// Color de acento (1.7.3): siete opciones, cada una con su versión clara y
// oscura (lib/accent.ts), y desde la 1.7.6 un color propio con su selector
// (el último círculo). Cada muestra enseña el tono del tema actual.
function CustomAccentButton({ selected, onApply }: { selected: boolean; onApply: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const hex = getCustomHex();
  const tone = customAccent(hex);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          title={tr('Color propio')}
          aria-label={tr('Color propio')}
          className={cn(
            'relative h-[18px] w-[18px] overflow-hidden rounded-full border border-border/60 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected && 'ring-2 ring-foreground/80 ring-offset-2 ring-offset-background'
          )}
          style={selected ? undefined : { background: 'conic-gradient(from 0deg,#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#d946ef,#f43f5e)' }}
        >
          {selected && (
            <>
              <span className="absolute inset-0 dark:hidden" style={{ background: `hsl(${tone.light.primary})` }} />
              <span className="absolute inset-0 hidden dark:block" style={{ background: `hsl(${tone.dark.primary})` }} />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-3">
        <ColorPicker
          initial={hex}
          onApply={(value) => {
            onApply(value);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function AccentSelector() {
  const [accent, setAccentState] = useState<AccentId>(() => getAccent());
  // Con el color de un mod (extensión Animaciones), este queda guardado debajo.
  const animaciones = useExtensionOn(ANIMACIONES);
  const mods = useContributions('appearance');
  const look = useLook();
  const modAccent = animaciones && !!effectiveLook(look, mods).accentFrom;
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-muted-foreground text-xs">{tr('Color')}</p>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={tr('Color de acento')}>
        {ACCENTS.map((a) => {
          const selected = accent === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={tr(a.name)}
              aria-label={tr(a.name)}
              onClick={() => {
                setAccent(a.id);
                setAccentState(a.id);
              }}
              className={cn(
                'relative h-[18px] w-[18px] overflow-hidden rounded-full border border-border/60 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected && 'ring-2 ring-foreground/80 ring-offset-2 ring-offset-background'
              )}
            >
              <span className="absolute inset-0 dark:hidden" style={{ background: `hsl(${a.light.primary})` }} />
              <span className="absolute inset-0 hidden dark:block" style={{ background: `hsl(${a.dark.primary})` }} />
            </button>
          );
        })}
        <CustomAccentButton
          selected={accent === 'personal'}
          onApply={(hex) => {
            setCustomAccent(hex);
            setAccentState('personal');
          }}
        />
      </div>
      {modAccent && <p className="max-w-[11rem] text-center text-[10px] leading-tight text-muted-foreground">{tr('Ahora manda el color de un mod (Extensiones › Animaciones).')}</p>}
    </div>
  );
}

/** El documento legal se carga al abrir su recuadro (y solo en el idioma de la interfaz). */
/** Modo Avanzado (1.7.3): el interruptor y lo que añade. Apagado por defecto
 *  para quien empieza; quien ya usaba esas funciones lo tiene encendido (ver
 *  `advancedMode` en CourseContext). Apagarlo no borra nada: solo oculta. */
function AdvancedModeCard() {
  const { advancedMode, setAdvancedMode } = useCourse();
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card px-4 py-3">
      <div className="min-w-0">
        <label htmlFor="advanced-mode" className="cursor-pointer text-sm font-semibold text-foreground">
          {tr('Modo Avanzado')}
        </label>
        {/* Una línea (1.8.0, Diego): el detalle está en «Qué cambia con el modo Avanzado». */}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {tr('Notas, informes, metas y más detalle en las tareas. Apagarlo no borra nada.')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
      <AdvancedCompareButton />
      <Switch
        id="advanced-mode"
        checked={advancedMode}
        onCheckedChange={setAdvancedMode}
        aria-label={tr('Modo Avanzado')}
        className="data-[state=unchecked]:bg-muted-foreground/30"
      />
      </div>
    </div>
  );
}

/** Qué cambia con el modo Avanzado, en dos columnas (1.7.6). */
const ADVANCED_COMPARE: { area: string; basic: string; advanced: string }[] = [
  { area: 'Estudio', basic: 'Temporizador y sesiones', advanced: 'Además, el modo Rendimiento: enfoque de 1 a 20 y notas AD, A, B y C' },
  { area: 'Calendario', basic: 'Tareas y fechas', advanced: 'Además, el calendario de calificaciones' },
  { area: 'Asignaturas', basic: 'Asignaturas, tareas y notas', advanced: 'Además, el progreso académico de cada una' },
  { area: 'Tareas', basic: 'Título, fecha y asignatura', advanced: 'Además, importancia, dificultad, tiempo estimado y avance' },
  { area: 'Metas', basic: 'Meta de racha', advanced: 'Además, metas diarias de estudio (en minutos)' },
  { area: 'Ajustes', basic: 'Tu expediente', advanced: 'Además, los informes de rendimiento y de pendientes' },
];

function AdvancedCompareButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-primary"
        onClick={() => setOpen(true)}
        title={tr('Qué cambia con el modo Avanzado')}
        aria-label={tr('Qué cambia con el modo Avanzado')}
      >
        <Info className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-primary">{tr('Qué cambia con el modo Avanzado')}</DialogTitle>
            <DialogDescription>{tr('Al apagarlo no se borra nada: solo se oculta.')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border/60 text-sm">
            <div className="border-b border-r border-border/60 bg-muted/40 px-3 py-2 font-semibold">{tr('Esencial')}</div>
            <div className="border-b border-border/60 bg-primary/10 px-3 py-2 font-semibold text-primary">{tr('Avanzado')}</div>
            {ADVANCED_COMPARE.map((row, i) => (
              <React.Fragment key={row.area}>
                <div className={cn('border-r border-border/60 px-3 py-2', i < ADVANCED_COMPARE.length - 1 && 'border-b')}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tr(row.area)}</p>
                  <p>{tr(row.basic)}</p>
                </div>
                <div className={cn('px-3 py-2', i < ADVANCED_COMPARE.length - 1 && 'border-b border-border/60')}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tr(row.area)}</p>
                  <p>{tr(row.advanced)}</p>
                </div>
              </React.Fragment>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LegalBody({ load }: { load: () => Promise<string> }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void load()
      .then((text) => alive && setMarkdown(text))
      .catch(() => alive && setMarkdown(tr('No se pudo abrir el documento.')));
    return () => {
      alive = false;
    };
  }, [load]);
  if (markdown === null) {
    return (
      <div className="flex h-40 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  return <LegalDocument markdown={markdown} />;
}

export default function SettingsPage() {
  const { 
    studyGoals, 
    updateStudyGoals, 
    userProfile, 
    selectionMode,
    setSelectionMode,
    streakGoal,
    updateStreakGoal,
    advancedMode,
  } = useCourse();
  const navigate = useNavigate();
  const extensionsOn = useInstalledExtensions().filter((e) => e.enabled).length;

  const [localGoals, setLocalGoals] = useState<StudyGoals>(studyGoals);
  const { toast } = useToast();

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [isEditingGoals, setIsEditingGoals] = useState(false);

  // Se relee sola: también cuando la foto llega de otro dispositivo.
  const [profileAvatar, setProfileAvatar] = useStoredImage(userProfile ? `profileAvatar_${userProfile.id}` : null);
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedUsername, setEditedUsername] = useState('');
  
  const [isEditingStreakGoal, setIsEditingStreakGoal] = useState(false);
  const [editedStreakValue, setEditedStreakValue] = useState<string | number>('');

  const [cropperOpen, setCropperOpen] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);



  useEffect(() => {
    setLocalGoals(studyGoals);
  }, [studyGoals]);

  useEffect(() => {
    if (userProfile) setEditedUsername(userProfile.username || '');
  }, [userProfile]);

  const handleGoalChange = (day: keyof StudyGoals, value: string) => {
    const minutes = parseInt(value, 10);
    if (!isNaN(minutes) && minutes >= 0) {
      setLocalGoals(prev => ({ ...prev, [day]: minutes }));
    } else if (value === '') {
      setLocalGoals(prev => ({ ...prev, [day]: 0 }));
    }
  };
  
  const handleSaveGoals = () => {
    updateStudyGoals(localGoals);
    setIsEditingGoals(false);
    toast({
        title: tr('Metas guardadas'),
        description: tr('Tus metas diarias de estudio se actualizaron.'),
    });
  };
  
  const handleCancelEditGoals = () => {
    setLocalGoals(studyGoals); // Revert changes
    setIsEditingGoals(false);
  }
  
  const handleStartEditingProfile = () => {
    if (userProfile) {
      setEditedUsername(userProfile.username || '');
    }
    setIsEditingProfile(true);
  };

  const handleSaveProfile = () => {
    if (!userProfile) return;

    if (editedUsername.trim().length === 0) {
        toast({
            variant: "destructive",
            title: tr('Error'),
            description: tr('El nombre de usuario no puede estar vacío.'),
        });
        return;
    }
    if (editedUsername.trim().length > 12) {
        toast({
            variant: "destructive",
            title: tr('Error'),
            description: tr('El nombre de usuario no puede tener más de 12 caracteres.'),
        });
        return;
    }

    const storedProfileRaw = localStorage.getItem('userProfile');
    const storedProfile = storedProfileRaw ? JSON.parse(storedProfileRaw) : {};
    
    const updatedProfile: UserProfile = {
        ...storedProfile,
        id: userProfile.id,
        username: editedUsername.trim(),
        isGuest: userProfile.isGuest,
        createdAt: userProfile.createdAt, // Preserve existing creation date
    };

    localStorage.setItem('userProfile', JSON.stringify(updatedProfile));
    // Con cuenta, el nombre vive también en Supabase: sin subirlo, el próximo
    // arranque rehidrata el perfil desde la nube y devolvía el nombre antiguo.
    if (!userProfile.isGuest && isSupabaseConfigured) {
      void updateUsername(updatedProfile.username ?? '').catch(() => undefined);
    }

    setIsEditingProfile(false);
    
    toast({
        title: tr('Perfil guardado'),
        description: tr('Tu información de perfil ha sido actualizada.'),
    });
    window.dispatchEvent(new CustomEvent('profileUpdated'));
  };

  const handleCancelEditProfile = () => {
      setIsEditingProfile(false);
      if (userProfile) {
          setEditedUsername(userProfile.username || '');
      }
  };

  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && userProfile) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            setImageToCrop(result);
            setCropperOpen(true);
        };
        reader.readAsDataURL(file);
    }
  };

  const handleStartEditStreakGoal = () => {
    if (selectionMode === 'rendimiento') {
        setEditedStreakValue(streakGoal.grade);
    } else {
        setEditedStreakValue(streakGoal.minutes);
    }
    setIsEditingStreakGoal(true);
  };

  const handleCancelEditStreakGoal = () => {
    setIsEditingStreakGoal(false);
  };

  const gradeOrder: ('B' | 'A' | 'AD')[] = ['B', 'A', 'AD'];

  const handleChangeGrade = (direction: 'prev' | 'next') => {
    const currentIndex = gradeOrder.indexOf(editedStreakValue as 'B' | 'A' | 'AD');
    if (direction === 'next' && currentIndex < gradeOrder.length - 1) {
      setEditedStreakValue(gradeOrder[currentIndex + 1]);
    } else if (direction === 'prev' && currentIndex > 0) {
      setEditedStreakValue(gradeOrder[currentIndex - 1]);
    }
  };

  const handleSaveStreakGoal = () => {
    if (selectionMode === 'rendimiento') {
        updateStreakGoal({
            grade: editedStreakValue as 'B' | 'A' | 'AD'
        });
    } else {
        const minutes = Number(editedStreakValue);
        if (!isNaN(minutes) && minutes > 0) {
            updateStreakGoal({
                minutes: minutes
            });
        }
    }
    setIsEditingStreakGoal(false);
    toast({
        title: tr('Meta de racha guardada'),
        description: tr('Tu meta ha sido actualizada.'),
    });
  };

  // Los tres documentos de la app, con los datos de esta instalación ya
  // interpolados (versión, identificador y fecha de la compilación). En
  // inglés, su traducción (el español es el que manda: cláusula 29). En los
  // idiomas de 1.7.3 se muestra esa misma traducción inglesa: los documentos
  // no se tradujeron a esos idiomas y el auténtico sigue siendo el español.
  const lang = useLang();
  const LEGAL_DIALOGS = useMemo(() => {
    const english = lang !== 'es';
    const appVersion = APP_VERSION;
    const installId = accountCode(userProfile?.id) ?? tr('sin identificador');
    const stamp = format(parseISO(BUILD_DATE), tr('d \'de\' MMMM \'de\' yyyy'), { locale: dateLocale() });

    return [
      {
        key: 'info',
        label: tr('Información del sistema'),
        title: tr('Información y novedades'),
        subtitle: tr('Frame {appVersion} · documento versión {INFO_VERSION}', { appVersion, INFO_VERSION }),
        load: async () =>
          english
            ? (await import('@/lib/legal/info-en')).infoDocumentEn({ appVersion, installId, releaseDate: stamp })
            : (await import('@/lib/legal/info')).infoDocument({ appVersion, installId, releaseDate: stamp }),
      },
      {
        key: 'terms',
        label: tr('Términos de servicio'),
        title: tr('Términos, condiciones y privacidad'),
        subtitle: tr('Versión {TERMS_VERSION} · Legislación peruana · Ley N.º 29733 y Ley N.º 29571', { TERMS_VERSION }),
        load: async () =>
          english
            ? (await import('@/lib/legal/terms-en')).termsDocumentEn({ appVersion, effectiveDate: stamp })
            : (await import('@/lib/legal/terms')).termsDocument({ appVersion, effectiveDate: stamp }),
      },
      {
        key: 'support',
        label: tr('Reportar un error'),
        title: tr('Soporte y reporte de errores'),
        subtitle: tr('Versión {SUPPORT_VERSION} · Incluye el puerto seguro para vulnerabilidades', { SUPPORT_VERSION }),
        load: async () =>
          english
            ? (await import('@/lib/legal/support-en')).supportDocumentEn({ appVersion, installId, effectiveDate: stamp })
            : (await import('@/lib/legal/support')).supportDocument({ appVersion, installId, effectiveDate: stamp }),
      },
    ];
    // El idioma también: al cambiarlo en Ajustes, los documentos cambian con él.
  }, [userProfile, lang]);


  return (
    <div className="space-y-6 px-6 pb-6 pt-2 md:px-8 md:pb-8 md:pt-4">
         <input
          type="file"
          ref={avatarInputRef}
          onChange={handleAvatarUpload}
          className="hidden"
          accept="image/*"
        />

        {/* ------------------------------------------------------------------
            Cabecera del perfil.

            Antes esto eran tres piezas sueltas flotando en la misma fila: el
            avatar, un "Miembro desde" solo en mitad del vacío y una rueda
            huérfana encima del selector de tema. Ahora es UN panel con tres
            zonas de peso decreciente —identidad, expediente y ajustes— y la
            rueda vive dentro de la zona de ajustes, con su etiqueta, en vez
            de colgar de una esquina.

            1.6.8 (Diego): con Frame en media pantalla, dos filas y no cuatro.
            Arriba la identidad con «Miembro desde» a su derecha; abajo el
            idioma, la divisoria y el tema con la cuenta. En una pantalla ancha
            (xl) los dos grupos se disuelven (`contents`) y todo va en una fila.
            ------------------------------------------------------------------ */}
        <div className="rounded-xl border border-border/70 bg-card/40 p-5">
          {/* En una fila solo si cabe (1.9.2): con la barra lateral, el perfil, el idioma, el tema,
              el color y la cuenta piden unos 1340 px de ventana. Entre 1280 y eso se desbordaban a
              lo ancho y «Cuenta» quedaba fuera de la pantalla (pantallas de 1280 px, o Windows al 150 %). */}
          <div className="flex flex-col gap-5 min-[1400px]:flex-row min-[1400px]:items-center">
           <div className="flex flex-wrap items-center justify-between gap-4 min-[1400px]:contents">
            {/* --- Identidad --- */}
            <div className="flex min-w-0 items-center gap-4 min-[1400px]:shrink-0 2xl:gap-5">
              <div
                className={cn(
                  'flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-secondary min-[1400px]:h-24 min-[1400px]:w-24 2xl:h-28 2xl:w-28',
                  isEditingProfile && 'cursor-pointer animate-pulse-border-infinite border-2 border-primary'
                )}
                onClick={() => {
                  if (isEditingProfile) handleAvatarClick();
                }}
                onMouseDown={(e) => {
                  if (isEditingProfile) e.preventDefault();
                }}
              >
                {profileAvatar ? (
                  <Image src={profileAvatar} alt={tr('Foto de perfil')} width={112} height={112} className="h-full w-full object-cover" />
                ) : (
                  <User className="h-14 w-14 text-primary" />
                )}
              </div>

              <div className="min-w-0 space-y-1">
                <div className="group flex items-center gap-2">
                  {isEditingProfile ? (
                    <Input
                      value={editedUsername}
                      onChange={(e) => setEditedUsername(e.target.value)}
                      onBlur={handleSaveProfile}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') handleCancelEditProfile();
                      }}
                      placeholder={tr('Nombre de usuario')}
                      className="h-9 w-48 font-headline text-xl font-bold"
                      maxLength={12}
                      autoFocus
                    />
                  ) : (
                    <>
                      <h1 className="truncate font-headline text-xl font-bold text-foreground">
                        {usernameLabel(userProfile?.username)}
                      </h1>
                      <Button
                        onClick={handleStartEditingProfile}
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        title={tr('Cambiar el nombre')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>

                <RealNameRow userProfile={userProfile} />
                <p className="text-xs text-muted-foreground">
                  {userProfile?.isGuest ? tr('Sesión local · solo en este equipo') : (userProfile?.email ?? tr('Cuenta sincronizada'))}
                </p>
                {/* Identificador de la cuenta. Toda cuenta tiene uno, también
                    las de correo y Google, que antes salían sin él (ver
                    account-code.ts). Se copia con un toque. */}
                {accountCode(userProfile?.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      const code = accountCode(userProfile?.id);
                      if (!code) return;
                      void navigator.clipboard?.writeText(code).then(
                        () => toast({ title: tr('ID copiado'), description: code }),
                        () => undefined
                      );
                    }}
                    className="group/id flex items-center gap-1.5 rounded px-1 -mx-1 font-mono text-[11px] tabular-nums text-muted-foreground/80 transition-colors hover:bg-primary/10 hover:text-primary"
                    title={tr('Copiar el ID de tu cuenta')}
                  >
                    {tr('ID')}{' '}{accountCode(userProfile?.id)}
                    <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover/id:opacity-100" />
                  </button>
                )}
              </div>
            </div>

            {/* --- Antigüedad de la cuenta --- */}
            <div className="flex shrink-0 items-center min-[1400px]:flex-1">
              <div className="flex flex-col justify-center gap-1 rounded-lg border border-border/60 bg-gradient-to-b from-primary/[0.07] to-transparent px-4 py-3">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                  {tr('Miembro desde')}
                </span>
                <span className="whitespace-nowrap font-headline text-base font-bold text-foreground">
                  {userProfile?.createdAt
                    ? format(parseISO(userProfile.createdAt), tr('d \'de\' MMMM, yyyy'), { locale: dateLocale() })
                    : '—'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {userProfile?.createdAt
                    ? (() => {
                        const days = Math.max(1, differenceInCalendarDays(new Date(), parseISO(userProfile.createdAt)));
                        return days === 1 ? tr('1 día con Frame') : tr('{days} días con Frame', { days });
                      })()
                    : tr('sin fecha registrada')}
                </span>
              </div>
            </div>

           </div>

           <div className="flex flex-wrap items-start justify-center gap-5 min-[1400px]:contents">
            {/* --- Idioma, a la izquierda de la divisoria (1.6.7). --- */}
            <div className="flex shrink-0 items-start">
              <LanguageSelector />
            </div>

            {/* --- Ajustes: tema y cuenta, juntos y etiquetados. La rueda abre
                un menú pequeño a su lado (AccountCard), no un recuadro. --- */}
            <div className="flex shrink-0 items-start gap-5 border-l border-border/60 pl-5">
              <ThemeSelector />
              <AccentSelector />
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-bold text-muted-foreground">{tr('Cuenta')}</p>
                <AccountMenu userProfile={userProfile} />
              </div>
            </div>
           </div>
          </div>
        </div>
        
        {/* Modo Avanzado (mitad izquierda) y Extensiones (mitad derecha), 1.7.6.
            La sección de extensiones está en /extensiones. */}
        <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2">
          <AdvancedModeCard />
          <button
            type="button"
            onClick={() => navigate('/extensiones')}
            className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
          >
            <Puzzle className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{tr('Extensiones')}</span>
              <span className="block text-xs text-muted-foreground">
                {extensionsOn > 0 ? tr('{count} activas', { count: extensionsOn }) : tr('Añade funciones a Frame')}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </div>

        {/* Dispositivos de la cuenta y su sincronización (1.9.2). */}
        <div className="pt-6">
          <DevicesCard userProfile={userProfile} />
        </div>

        {/* Metas diarias (minutos) y escala AD/A/B/C: modo Avanzado. Las
            metas siguen guardadas y midiendo el día aunque no se vean. */}
        {advancedMode && (
        <div className="space-y-2 pt-6">
            <div className="flex justify-center items-center relative mb-6">
                <h2 className="text-xl font-semibold leading-none tracking-tight text-center text-primary">
                    {tr('Metas diarias de estudio')}
                </h2>
                <div className="absolute right-0 flex items-center gap-2">
                    {isEditingGoals ? (
                        <>
                            <Button variant="ghost" size="icon" onClick={handleSaveGoals} className="h-8 w-8 text-green-500 hover:text-green-600">
                                <Check className="h-5 w-5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={handleCancelEditGoals} className="h-8 w-8 text-red-500 hover:text-red-600">
                                <X className="h-5 w-5" />
                            </Button>
                        </>
                    ) : (
                        <Button variant="ghost" size="icon" onClick={() => setIsEditingGoals(true)} className="h-8 w-8 text-muted-foreground" title={tr('Editar las metas')}>
                            <Pencil className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-7 border rounded-lg overflow-hidden bg-card">
              {daysOfWeek.map(({ key, label }, index) => (
                <div key={key} className={cn(
                  "flex flex-col items-center border-b md:border-b-0",
                  index < daysOfWeek.length - 1 && "md:border-r"
                )}>
                    <div className="w-full text-center text-xs font-semibold text-foreground p-2 bg-muted/50 border-b">
                        {label}
                    </div>
                    <div className="p-3 w-full flex items-center justify-center bg-background">
                        <Input
                            id={key}
                            type="number"
                            value={localGoals[key] === 0 ? '' : localGoals[key]}
                            onChange={(e) => handleGoalChange(key, e.target.value)}
                            placeholder="0"
                            className="w-full text-center bg-transparent border-0 h-auto p-1 focus-visible:ring-0 focus-visible:ring-offset-0 text-primary font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            disabled={!isEditingGoals}
                        />
                    </div>
                </div>
              ))}
            </div>
            {selectionMode === 'rendimiento' && (
              <div className="text-center text-muted-foreground text-xs space-x-4 pt-2">
                <span><span className="font-bold text-foreground">{tr('AD:')}</span> 18-20</span>
                <span><span className="font-bold text-foreground">A:</span> 14 - 17.9</span>
                <span><span className="font-bold text-foreground">B:</span> 11 - 13.9</span>
                <span><span className="font-bold text-foreground">C:</span>{' '}{tr('< 11')}</span>
              </div>
            )}
        </div>
        )}

        <div className="space-y-12">
            {/* Expediente completo: sustituye a las tres cifras sueltas
                (tiempo, tareas y favoritas) que había antes. */}
            <div className="pt-12">
                <ProfileStats />
            </div>

            {/* Izquierda: modo de medición, meta de racha y, debajo, «Tu racha».
                Derecha: «Informes», con el alto de toda la columna izquierda
                (1.6.6). */}
            {/* Sin modo Avanzado: solo la meta de racha (en minutos) y «Tu
                racha», centradas; sin pestañas de modo ni informes. */}
            <div className={advancedMode ? 'grid grid-cols-1 gap-6 items-stretch lg:grid-cols-2' : 'mx-auto grid w-full max-w-xl grid-cols-1 gap-6'}>
                <div className="flex flex-col gap-4 h-full">
                    {advancedMode && (
                    <Tabs value={selectionMode} onValueChange={(value) => setSelectionMode(value as 'rendimiento' | 'tiempo')} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="rendimiento" className="border-r">{tr('Rendimiento')}</TabsTrigger>
                            <TabsTrigger value="tiempo">{tr('Tiempo')}</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    )}
                    <Card className="w-full group/streak flex flex-col flex-grow">
                        <CardHeader className="relative flex flex-row items-center justify-center p-4">
                            <CardTitle className="text-lg font-bold text-primary flex-grow text-center">{tr('Meta de racha')}</CardTitle>
                            <div className="absolute right-4">
                                {isEditingStreakGoal ? (
                                    <div className="flex items-center gap-1">
                                        <Button onClick={handleSaveStreakGoal} size="icon" variant="ghost" className="h-7 w-7 text-green-500 hover:text-green-600"><Check className="h-4 w-4" /></Button>
                                        <Button onClick={handleCancelEditStreakGoal} size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600"><X className="h-4 w-4" /></Button>
                                    </div>
                                ) : (
                                    <Button onClick={handleStartEditStreakGoal} title={tr('Cambiar la meta de racha')} size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground opacity-0 group-hover/streak:opacity-100 transition-opacity"><Pencil className="h-4 w-4" /></Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 pt-3 flex flex-col flex-grow items-center justify-center">
                            {selectionMode === 'rendimiento' ? (
                                <div className="flex items-center justify-center gap-4">
                                    <Button size="icon" variant="ghost" onClick={() => handleChangeGrade('prev')} disabled={!isEditingStreakGoal || editedStreakValue === 'B'} className="h-8 w-8">
                                        <ChevronLeft className="h-6 w-6" />
                                    </Button>
                                    <span className="text-2xl font-bold w-12 text-center">
                                        {isEditingStreakGoal 
                                            ? editedStreakValue 
                                            : streakGoal.grade
                                        }
                                    </span>
                                    <Button size="icon" variant="ghost" onClick={() => handleChangeGrade('next')} disabled={!isEditingStreakGoal || editedStreakValue === 'AD'} className="h-8 w-8">
                                        <ChevronRight className="h-6 w-6" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center gap-2">
                                    {isEditingStreakGoal ? (
                                        <Input
                                            type="number"
                                            value={editedStreakValue}
                                            onChange={(e) => setEditedStreakValue(e.target.value)}
                                            className="w-24 text-2xl font-bold text-center h-auto p-0 bg-transparent border-b border-dashed border-input focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            autoFocus
                                        />
                                    ) : (
                                        <span className="text-2xl font-bold">{streakGoal.minutes}</span>
                                    )}
                                    <span className="text-sm text-muted-foreground">{tr('min')}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    <div className="flex flex-col"><StreakStatusCard /></div>
                </div>

                {/* Informes: rendimiento y pendientes, con vista previa real. En
                    pantallas anchas no empuja la fila: mide lo que la columna
                    izquierda, y su vista previa se desplaza dentro. */}
                {advancedMode && (
                <div className="relative min-h-[34rem] lg:min-h-0">
                <Card className="flex flex-col lg:absolute lg:inset-0">
                    <CardHeader className="p-4 pb-3">
                        <CardTitle className="text-center text-lg font-bold text-primary">{tr('Informes')}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-3">
                        <ReportCenter userProfile={userProfile} />
                    </CardContent>
                </Card>
                </div>
                )}
            </div>
        </div>

        <p className="pt-12 text-xs text-center text-muted-foreground">
          Frame{' '}{APP_VERSION}{' '}{tr('· Tus datos viven en este equipo · © 2026 Asvent')}
        </p>

        {/* ------------------------------------------------------------------
            Los tres documentos de la app. El texto vive en src/lib/legal/*
            como Markdown y lo pinta <LegalDocument />: así se actualiza un
            documento legal editando una cadena, y los campos que solo el
            titular puede rellenar se ven resaltados en vez de colarse.
            ------------------------------------------------------------------ */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          {LEGAL_DIALOGS.map(({ key, label, title, subtitle, load }, index) => (
            <React.Fragment key={key}>
              {index > 0 && <span className="text-muted-foreground">·</span>}
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs font-normal text-muted-foreground hover:text-primary"
                  >
                    [{label}]
                  </Button>
                </DialogTrigger>
                <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                  <DialogHeader className="shrink-0 px-6 pb-4 pt-6 relative overflow-hidden">
                    <EchoWord word={title.split(' ')[0].replace(',', '')} />
                    <DialogTitle className="text-center text-xl font-bold text-primary">
                      {title}
                    </DialogTitle>
                    <p className="text-center text-[11px] text-muted-foreground">{subtitle}</p>
                  </DialogHeader>
                  <div aria-hidden className="mx-6 h-px shrink-0 bg-border" />
                  {/* Scroll nativo, no ScrollArea: son documentos de decenas
                      de páginas y aquí hace falta una barra VISIBLE que diga
                      cuánto queda por leer. */}
                  <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                    <LegalBody load={load} />
                  </div>
                </DialogContent>
              </Dialog>
            </React.Fragment>
          ))}
        </div>


        {cropperOpen && imageToCrop && userProfile && (
            <AvatarCropper
            imageSrc={imageToCrop}
            onClose={() => {
                setCropperOpen(false);
                setImageToCrop(null);
            }}
            onSave={async (croppedImage) => {
                try {
                await saveImage(`profileAvatar_${userProfile.id}`, croppedImage);
                setProfileAvatar(croppedImage);
                window.dispatchEvent(new CustomEvent('profileUpdated'));
                toast({
                    title: tr('Avatar actualizado'),
                    description: tr('Tu nueva foto de perfil ha sido guardada.'),
                });
                } catch (e: any) {
                console.error("Failed to save avatar:", e);
                const isQuotaError = e.name === 'QuotaExceededError';
                toast({
                    variant: "destructive",
                    title: isQuotaError ? tr('Imagen Demasiado Grande') : tr('Error al Guardar'),
                    description: isQuotaError
                    ? tr('La imagen es demasiado grande. Por favor, elige un archivo más pequeño.')
                    : tr('Ocurrió un error inesperado al guardar el avatar.'),
                });
                } finally {
                setCropperOpen(false);
                setImageToCrop(null);
                }
            }}
            />
        )}

    </div>
  );
}
