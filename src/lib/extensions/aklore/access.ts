import { useEffect, useState } from 'react';
import { domainHashOf, officialById } from '@/lib/extensions/catalog';
import { useExtensionOn } from '@/lib/extensions/store';
import { AKLORE } from '@/lib/extensions/aklore/source';

/**
 * ¿Puede esta cuenta usar AK Lore ahora? Solo con la extensión activa y un
 * correo del dominio del colegio (comparado por su resumen SHA-256: el
 * código público no nombra el colegio). Se vuelve a mirar al cambiar de
 * cuenta, aunque la extensión siga instalada.
 */
export function useAkLoreAccess(email: string | null | undefined): 'off' | 'checking' | 'allowed' | 'denied' {
  const on = useExtensionOn(AKLORE);
  const expected = officialById(AKLORE)?.domainHash ?? null;
  const [hash, setHash] = useState<{ email: string; hash: string | null } | null>(null);

  useEffect(() => {
    if (!on || !email) return;
    let alive = true;
    void domainHashOf(email).then((h) => alive && setHash({ email, hash: h }));
    return () => {
      alive = false;
    };
  }, [on, email]);

  if (!on) return 'off';
  if (!email || !expected) return 'denied';
  if (!hash || hash.email !== email) return 'checking';
  return hash.hash === expected ? 'allowed' : 'denied';
}
