import { isTauri } from '@tauri-apps/api/core';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DriveLogo } from '@/components/integrations/DriveIcon';
import GoogleEmbed from '@/components/integrations/GoogleEmbed';
import { useExtensionOn } from '@/lib/extensions/store';
import { useWireStatus, WIRE } from '@/lib/extensions/wire/relay';
import { useRouter } from '@/lib/navigation';
import { tr } from '@/lib/i18n';

// Interfaz "Drive" (1.8.0): el Google Drive REAL incrustado, a sangre, igual
// que Classroom y Gmail, con la cuenta conectada en la extensión Wire. Sale en
// el menú (bajo Classroom) solo con Wire activa.
export default function DrivePage() {
  const router = useRouter();
  const wireOn = useExtensionOn(WIRE);
  const { account } = useWireStatus();

  const notice = (text: string, action?: { label: string; href: string }) => (
    <Card className="mx-4 my-auto flex flex-wrap items-center gap-3 p-4 md:mx-8">
      <DriveLogo className="h-7 w-7 shrink-0" />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">{text}</p>
      {action && (
        <Button size="sm" variant="outline" onClick={() => router.push(action.href)}>
          {action.label}
        </Button>
      )}
    </Card>
  );

  return (
    <div className="flex h-full min-h-0 flex-col py-4">
      {!isTauri()
        ? notice(tr('El recuadro de Drive integrado está disponible en la app de escritorio Frame.'))
        : !wireOn
          ? notice(tr('Drive aparece aquí con la extensión Wire activa.'), { label: tr('Abrir Wire'), href: '/extensiones?ext=frame.wire' })
          : !account
            ? notice(tr('Conecta tu cuenta de Google en Wire para ver aquí su Drive.'), { label: tr('Abrir Wire'), href: '/extensiones?ext=frame.wire' })
            : (
              <Card className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border-x-0">
                <GoogleEmbed kind="drive" account={account} heightClass="min-h-0 flex-1" />
              </Card>
            )}
    </div>
  );
}
