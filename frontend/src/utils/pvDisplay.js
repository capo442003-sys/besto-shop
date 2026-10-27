import { canAccessAllPvs, isPvScoped, pvDisplayLabel, isZoneManager } from './pvScope';
import { formatGNF } from './format';

/** Admin ou responsable zone — afficher le PV du client pour éviter les homonymes */
export function shouldShowClientPv(user) {
  return canAccessAllPvs(user) || isZoneManager(user);
}

export function clientPvShort(client) {
  if (!client?.delivery_point_code) return '';
  const name = String(client.delivery_point_name || '').trim();
  return name ? `${client.delivery_point_code} — ${name}` : client.delivery_point_code;
}

export function clientDisplayLabel(client, user) {
  const name = client?.name || '';
  const pv = clientPvShort(client);
  if (client?.code === 'COMPTOIR' && client?.delivery_point_code) {
    return `${name} (${client.delivery_point_code})`;
  }
  if (shouldShowClientPv(user) && pv) {
    return `${name} · ${pv}`;
  }
  return name;
}

/** Libellé liste / encaissement client — nom, PV (admin), code, dette, avance */
export function clientEncaissementOptionLabel(client, user, debt = 0, advance = 0) {
  const parts = [clientDisplayLabel(client, user)];
  const code = client?.code;
  if (code && code !== 'COMPTOIR' && shouldShowClientPv(user)) {
    parts.push(code);
  }
  const debtAmount = parseFloat(debt);
  if (Number.isFinite(debtAmount) && debtAmount > 0.005) {
    parts.push(formatGNF(debtAmount));
  }
  const advanceAmount = parseFloat(advance ?? client?.advance_balance ?? 0);
  if (Number.isFinite(advanceAmount) && advanceAmount > 0.005) {
    parts.push(`avance ${formatGNF(advanceAmount)}`);
  }
  return parts.join(' — ');
}

export function pvBadgeLabel(user, selectedPv) {
  if (selectedPv) return `${selectedPv.code} — ${selectedPv.name}`;
  if (isPvScoped(user) || isZoneManager(user)) return pvDisplayLabel(user);
  return '';
}
