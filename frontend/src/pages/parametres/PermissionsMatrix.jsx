import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';

const PERM_KEYS = ['can_view', 'can_create', 'can_edit', 'can_delete', 'can_print'];

const PERM_LABELS = {
  can_view: 'Voir',
  can_create: 'Créer',
  can_edit: 'Modifier',
  can_delete: 'Suppr.',
  can_print: 'Impr.',
};

const MODULE_LABELS = {
  dashboard: 'Tableau de bord',
  ventes: 'Ventes',
  produits: 'Produits',
  finances: 'Finances',
  employes: 'Employés',
  parametres: 'Paramètres',
  caisse: 'Caisse',
  admin: 'Admin',
};

function cloneMatrix(payload) {
  return {
    modules: [...(payload.modules || [])],
    roles: (payload.roles || []).map((role) => ({
      ...role,
      modules: (role.modules || []).map((mod) => ({ ...mod })),
    })),
  };
}

function matrixFingerprint(payload) {
  if (!payload?.roles) return '';
  return JSON.stringify(
    payload.roles.map((role) => ({
      role_id: role.role_id,
      modules: role.modules.map((m) => ({
        module_code: m.module_code,
        can_view: !!m.can_view,
        can_create: !!m.can_create,
        can_edit: !!m.can_edit,
        can_delete: !!m.can_delete,
        can_print: !!m.can_print,
      })),
    })),
  );
}

export default function PermissionsMatrix() {
  const notify = useNotify();
  const [data, setData] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dirty = useMemo(
    () => Boolean(data) && matrixFingerprint(data) !== baseline,
    [data, baseline],
  );

  const load = () => {
    setLoading(true);
    api.get('/settings/permissions-matrix')
      .then((r) => {
        const next = cloneMatrix(r.data);
        setData(next);
        setBaseline(matrixFingerprint(next));
        setError('');
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Impossible de charger la matrice des permissions');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const togglePerm = (roleId, moduleCode, key) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        roles: prev.roles.map((role) => {
          if (role.role_id !== roleId) return role;
          return {
            ...role,
            modules: role.modules.map((mod) => {
              if (mod.module_code !== moduleCode) return mod;
              return { ...mod, [key]: !mod[key] };
            }),
          };
        }),
      };
    });
  };

  const save = async () => {
    if (!data || !dirty) return;
    setSaving(true);
    try {
      const permissions = [];
      for (const role of data.roles) {
        for (const mod of role.modules) {
          permissions.push({
            role_id: role.role_id,
            module_code: mod.module_code,
            can_view: Boolean(mod.can_view),
            can_create: Boolean(mod.can_create),
            can_edit: Boolean(mod.can_edit),
            can_delete: Boolean(mod.can_delete),
            can_print: Boolean(mod.can_print),
          });
        }
      }
      const { data: saved } = await api.put('/settings/permissions-matrix', { permissions });
      const next = cloneMatrix(saved);
      setData(next);
      setBaseline(matrixFingerprint(next));
      notify.success('Permissions enregistrées');
    } catch (err) {
      notify.error(apiErrorMessage(err, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!data) return;
    load();
  };

  if (loading) return <p>Chargement…</p>;
  if (error) return <p className="alert alert-warning">{error}</p>;
  if (!data?.roles?.length) {
    return (
      <p className="alert alert-warning">
        Aucun rôle trouvé. Vérifiez que les rôles et permissions sont initialisés (seed / migrations).
      </p>
    );
  }

  return (
    <div className="page-panel">
      <header className="bmb-page-head">
        <div className="bmb-page-head__text">
          <span className="bmb-page-head__eyebrow">Administration</span>
          <h1 className="bmb-page-head__title">Matrice des permissions</h1>
          <p className="bmb-page-head__subtitle">Cochez les droits par rôle et module, puis enregistrez.</p>
        </div>
        <div className="bmb-page-head__actions">
          <button type="button" className="btn btn-secondary" onClick={reset} disabled={saving || loading}>
            Actualiser
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'À jour'}
          </button>
        </div>
      </header>

      <aside className="bmb-context-help bmb-context-help--inline">
        <strong>Conseil :</strong> ne retirez pas toutes les permissions de `parametres` au rôle administrateur pour éviter le blocage du compte.
      </aside>

      {dirty && (
        <p className="alert alert-info">
          Modifications non enregistrées. Cliquez sur <strong>Enregistrer</strong> pour appliquer.
        </p>
      )}

      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full permissions-matrix-table">
          <thead>
            <tr>
              <th>Rôle</th>
              {data.modules.map((m) => (
                <th key={m} colSpan={5} style={{ textAlign: 'center' }}>
                  {MODULE_LABELS[m] || m}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {data.modules.map((m) => (
                PERM_KEYS.map((k) => (
                  <th key={`${m}-${k}`} style={{ fontSize: '0.7rem', textAlign: 'center' }}>{PERM_LABELS[k]}</th>
                ))
              ))}
            </tr>
          </thead>
          <tbody>
            {data.roles.map((role) => (
              <tr key={role.role_id}>
                <td>
                  <strong>{role.role_name}</strong>
                  <div className="bmb-data-note">{role.role_code}</div>
                </td>
                {role.modules.map((mod) => (
                  PERM_KEYS.map((k) => (
                    <td key={`${role.role_id}-${mod.module_code}-${k}`} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(mod[k])}
                        aria-label={`${role.role_name} · ${mod.module_code} · ${PERM_LABELS[k]}`}
                        onChange={() => togglePerm(role.role_id, mod.module_code, k)}
                        disabled={saving}
                      />
                    </td>
                  ))
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
