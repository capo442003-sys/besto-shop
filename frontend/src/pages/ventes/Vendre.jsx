import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import { sellerDisplayName, canAccessReglement, hasLinkedEmployee, canPayLaterInCaisse } from '../../utils/sellerScope';
import { isPvScoped, resolveDeliveryPointId, pvDisplayLabel } from '../../utils/pvScope';
import SearchSelect from '../../components/SearchSelect';
import {
  loadCaissePrefs, saveCaissePrefs, loadCaisseSession, saveCaisseSession, clearCaisseSession,
} from '../../utils/userPrefs';
import { formatGNF, formatQty, parseNumberInput, SALE_TYPES } from '../../utils/format';
import { balanceDueGnf, isFullyPaidGnf, roundGnf } from '../../utils/money';
import { apiErrorMessage } from '../../utils/apiError';
import { extractApiItems } from '../../utils/calculations';
import { parseClientsListResponse } from '../../utils/clientsApi';
import { clientDisplayLabel } from '../../utils/pvDisplay';
import AlertBanner from '../../components/AlertBanner';
import { useConfirm } from '../../context/ConfirmContext';
import { logoSrc, useStoreSettings } from '../../context/StoreSettingsContext';
import VendrePosView from './VendrePosView';
import { BRAND_LOGO } from '../../config/brandAssets';
import '../../styles/pos.css';

const emptyLine = { product_id: '', quantity: 1, discount: 0, unit_price: '' };

function clientSelectOption(c, user) {
  return { value: c.id, label: `${clientDisplayLabel(c, user)} — ${c.code}`, raw: c };
}

function effectiveStockDispo(info) {
  if (!info) return null;
  const v = info.effectively_available ?? info.remaining ?? info.pos_available ?? info.available;
  return v == null ? null : parseFloat(v);
}

export default function Vendre() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedProductOpt, setSelectedProductOpt] = useState(null);
  const [cart, setCart] = useState(null);
  const [prefs, setPrefs] = useState(() => loadCaissePrefs());
  const [lineForm, setLineForm] = useState(emptyLine);
  const [payment, setPayment] = useState({ amount_paid: '', payment_mode: 'especes' });
  const [useClientAdvance, setUseClientAdvance] = useState(false);
  const useClientAdvanceRef = useRef(false);
  const [clientAdvanceBalance, setClientAdvanceBalance] = useState(0);
  const [encaisserMaintenant, setEncaisserMaintenant] = useState(true);
  const [stockInfo, setStockInfo] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [lineAdding, setLineAdding] = useState(false);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [booting, setBooting] = useState(false);
  const [bootError, setBootError] = useState('');
  const [awaitingCaisseOpen, setAwaitingCaisseOpen] = useState(() => !loadCaisseSession()?.open);
  const [comptoirClient, setComptoirClient] = useState(null);
  const finalizingCartIdRef = useRef(null);
  const prefsRef = useRef(prefs);
  const bootingRef = useRef(false);
  const creatingCartRef = useRef(false);
  const comptoirAssignedRef = useRef(null);
  const transitioningRef = useRef(false);
  const productInputRef = useRef(null);
  const quantityInputRef = useRef(null);
  const confirm = useConfirm();
  const { store } = useStoreSettings();
  const comptoirClientRef = useRef(null);
  const paymentRef = useRef(payment);
  prefsRef.current = prefs;
  comptoirClientRef.current = comptoirClient;
  paymentRef.current = payment;
  useClientAdvanceRef.current = useClientAdvance;

  const allowReglementToggle = canAccessReglement(user);
  const showPayLater = canPayLaterInCaisse(user);
  const linkedEmployeeId = user?.employee_id ? String(user.employee_id) : '';
  const canUseCaisse = hasLinkedEmployee(user);
  const pvLocked = isPvScoped(user);
  const mySellerLabel = sellerDisplayName(user);
  const myPvLabel = pvDisplayLabel(user);

  useEffect(() => {
    if (!allowReglementToggle) setEncaisserMaintenant(true);
  }, [allowReglementToggle]);

  const loadRefs = async () => {
    try {
      const saved = loadCaissePrefs();
      const { data: dpData } = await api.get('/delivery-points');
      setDeliveryPoints(dpData || []);
      const userPvId = user?.delivery_point_id ? String(user.delivery_point_id) : '';
      const defaultPvId = userPvId || (dpData?.[0]?.id ? String(dpData[0].id) : '');
      const resolvedPv = resolveDeliveryPointId(user, saved.delivery_point_id || defaultPvId) || defaultPvId;
      if (pvLocked && userPvId && resolvedPv !== userPvId) {
        saveCaissePrefs({ ...saved, delivery_point_id: userPvId });
      }
      const comptoirRes = await api.get('/clients/comptoir', {
        params: { delivery_point_id: resolvedPv },
      }).catch(() => ({ data: null }));
      if (comptoirRes.data) setComptoirClient(comptoirRes.data);
      setPrefs((p) => ({
        ...p,
        sale_type: saved.sale_type || p.sale_type || 'detail',
        delivery_point_id: resolvedPv || defaultPvId,
        seller_id: linkedEmployeeId,
      }));
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Impossible de charger les points de livraison'));
    } finally {
      setRefsLoaded(true);
    }
  };

  const createClientFromSearch = useCallback(async (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const pvId = prefsRef.current?.delivery_point_id || user?.delivery_point_id;
    const { data } = await api.post('/clients', {
      name: trimmed,
      client_type: 'particulier',
      ...(pvId ? { delivery_point_id: pvId } : {}),
    });
    return clientSelectOption(data, user);
  }, [user?.delivery_point_id]);

  const effectivePvId = useCallback(() => {
    if (pvLocked && user?.delivery_point_id) return String(user.delivery_point_id);
    return prefsRef.current?.delivery_point_id || (user?.delivery_point_id ? String(user.delivery_point_id) : '');
  }, [pvLocked, user?.delivery_point_id]);

  const searchClients = useCallback(async (q) => {
    const pvId = effectivePvId();
    const { data } = await api.get('/clients', {
      params: { search: q || undefined, ...(pvId ? { delivery_point_id: pvId } : {}) },
    });
    const items = parseClientsListResponse(data).clients.map((c) => clientSelectOption(c, user));
    const comptoir = comptoirClientRef.current;
    if (!comptoir) return items;
    const comptoirOpt = clientSelectOption(comptoir, user);
    const without = items.filter((i) => String(i.value) !== String(comptoirOpt.value));
    const query = (q || '').trim().toLowerCase();
    if (!query || query.includes('comptoir') || comptoirOpt.label.toLowerCase().includes(query)) {
      return [comptoirOpt, ...without];
    }
    return items;
  }, []);

  const searchProducts = useCallback(async (q) => {
    const pvId = effectivePvId();
    const { data } = await api.get('/products', {
      params: {
        search: q || undefined,
        pos: 'true',
        ...(pvId ? { delivery_point_id: pvId } : {}),
      },
    });
    return extractApiItems(data)
      .map((p) => {
        const dispo = p.pos_available ?? p.total_stock;
        const stock = dispo != null ? formatQty(dispo) : null;
        const stockSuffix = stock != null ? ` · ${stock} dispo caisse` : '';
        return { value: p.id, label: `${p.reference} — ${p.name}${stockSuffix}`, raw: p };
      });
  }, [effectivePvId]);

  useEffect(() => {
    if (authLoading) return;
    loadRefs();
  }, [authLoading, user?.employee_id, user?.delivery_point_id]);

  useEffect(() => {
    if (!user?.delivery_point_id || !pvLocked) return;
    setPrefs((p) => ({ ...p, delivery_point_id: String(user.delivery_point_id) }));
  }, [user?.delivery_point_id, pvLocked]);

  useEffect(() => {
    const sessionOpen = Boolean(loadCaisseSession()?.open);
    const inCaisseFlow = Boolean(cart) || (sessionOpen && !awaitingCaisseOpen);
    const root = document.documentElement;
    const isMobileCaisse = () => (
      window.matchMedia('(max-width: 960px)').matches
      || root.classList.contains('app-pwa-mobile')
    );
    const sync = () => {
      root.classList.toggle('app-caisse-active', inCaisseFlow && isMobileCaisse());
    };
    sync();
    const mq = window.matchMedia('(max-width: 960px)');
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      root.classList.remove('app-caisse-active');
    };
  }, [cart, awaitingCaisseOpen]);

  useEffect(() => {
    if (!linkedEmployeeId) return;
    setPrefs((p) => ({ ...p, seller_id: linkedEmployeeId }));
  }, [linkedEmployeeId, user?.employee_name, user?.employee_matricule, user?.full_name]);

  useEffect(() => {
    if (!cart?.client_id) {
      if (!cart?.client_name) setSelectedClient(null);
      return;
    }
    setSelectedClient((prev) => {
      if (prev && String(prev.value) === String(cart.client_id)) return prev;
      return { value: cart.client_id, label: cart.client_name || `Client #${cart.client_id}` };
    });
  }, [cart?.id, cart?.client_id, cart?.client_name]);

  const createNewCart = useCallback(async (opts = {}) => {
    const { silent = false, client_id = '', prefsOverride } = opts;
    if (creatingCartRef.current) return null;
    const p = { ...(prefsOverride || prefsRef.current) };
    p.seller_id = linkedEmployeeId;
    if (pvLocked && user?.delivery_point_id) {
      p.delivery_point_id = String(user.delivery_point_id);
    }
    if (!p.delivery_point_id || !p.seller_id) {
      const err = !p.seller_id
        ? 'Aucun employé lié à votre compte — contactez un administrateur pour lier votre fiche employé'
        : 'Aucun point de livraison configuré';
      setBootError(err);
      if (!silent) setMessage(err);
      return null;
    }
    if (!silent) {
      const ok = await confirm({
        title: 'Ouvrir la caisse',
        message: 'Démarrer une nouvelle vente (nouveau panier) ?',
        confirmLabel: 'Ouvrir la caisse',
      });
      if (!ok) return null;
    }
    creatingCartRef.current = true;
    if (!silent) setLoading(true);
    setBootError('');
    setBooting(true);
    setAwaitingCaisseOpen(false);
    try {
      const resolvedClientId = client_id || comptoirClientRef.current?.id || null;
      const { data } = await api.post('/sales/carts', {
        sale_type: p.sale_type,
        client_id: resolvedClientId,
        seller_id: p.seller_id,
        delivery_point_id: p.delivery_point_id,
      });
      setCart(data);
      setLineForm(emptyLine);
      setStockInfo(null);
      setSelectedProductOpt(null);
      setPayment({ amount_paid: '', payment_mode: 'especes' });
      setEncaisserMaintenant(true);
      if (resolvedClientId && comptoirClientRef.current && String(resolvedClientId) === String(comptoirClientRef.current.id)) {
        setSelectedClient(clientSelectOption(comptoirClientRef.current, user));
      } else if (data.client_id) {
        setSelectedClient(
          data.client_name
            ? { value: data.client_id, label: data.client_name }
            : null
        );
      } else {
        setSelectedClient(null);
      }
      setBootError('');
      setMessage('');
      return data;
    } catch (e) {
      const err = apiErrorMessage(e, 'Impossible de créer le panier');
      setBootError(err);
      if (!silent) setMessage(err);
      return null;
    } finally {
      setBooting(false);
      creatingCartRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [linkedEmployeeId, pvLocked, user?.delivery_point_id, confirm]);

  const readyToSell = Boolean(canUseCaisse && prefs.delivery_point_id && prefs.seller_id);

  useEffect(() => {
    if (!refsLoaded) return;
    saveCaissePrefs({
      sale_type: prefs.sale_type,
      delivery_point_id: prefs.delivery_point_id,
    });
  }, [prefs.sale_type, prefs.delivery_point_id, refsLoaded]);

  useEffect(() => {
    if (!refsLoaded || !prefs.delivery_point_id) return;
    api.get('/clients/comptoir', { params: { delivery_point_id: prefs.delivery_point_id } })
      .then((r) => {
        if (r.data) {
          setComptoirClient(r.data);
          comptoirAssignedRef.current = null;
        }
      })
      .catch(() => {});
  }, [prefs.delivery_point_id, refsLoaded]);

  const returnToCaisseSetup = (msg) => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    finalizingCartIdRef.current = null;
    bootingRef.current = false;
    setBooting(false);
    setLoading(false);
    setAwaitingCaisseOpen(true);
    setCart(null);
    setLineForm(emptyLine);
    setStockInfo(null);
    setSelectedProductOpt(null);
    setSelectedClient(null);
    setPayment({ amount_paid: '', payment_mode: 'especes' });
    setEncaisserMaintenant(true);
    setBootError('');
    if (msg !== undefined) setMessage(msg);
    transitioningRef.current = false;
  };

  const resetCartForm = () => {
    setLineForm(emptyLine);
    setStockInfo(null);
    setSelectedProductOpt(null);
    setPayment({ amount_paid: '', payment_mode: 'especes' });
    setEncaisserMaintenant(true);
    if (comptoirClientRef.current) {
      setSelectedClient(clientSelectOption(comptoirClientRef.current));
    } else {
      setSelectedClient(null);
    }
  };

  const prepareNextCart = useCallback(async (successMsg) => {
    if (transitioningRef.current || creatingCartRef.current) return null;
    transitioningRef.current = true;
    finalizingCartIdRef.current = null;
    setBootError('');
    resetCartForm();
    if (successMsg !== undefined) setMessage(successMsg);
    setLoading(true);
    setBooting(true);
    try {
      const session = loadCaisseSession();
      const p = session || prefsRef.current;
      const data = await createNewCart({
        silent: true,
        prefsOverride: p,
        client_id: comptoirClientRef.current?.id || '',
      });
      if (data) {
        window.setTimeout(() => productInputRef.current?.focus(), 80);
      }
      return data;
    } finally {
      setBooting(false);
      setLoading(false);
      transitioningRef.current = false;
    }
  }, [createNewCart]);

  const resumeOrOpenCart = useCallback(async (session) => {
    if (bootingRef.current || creatingCartRef.current) return;
    bootingRef.current = true;
    setBooting(true);
    setBootError('');
    setAwaitingCaisseOpen(false);
    try {
      const { data: carts } = await api.get('/sales/carts', {
        params: { status: 'en_cours', seller_id: session.seller_id },
      });
      const active = (carts || []).find((c) => c.status === 'en_cours');
      if (active) {
        const { data } = await api.get(`/sales/carts/${active.id}`);
        setCart(data);
        resetCartForm();
        if (data.client_id) {
          setSelectedClient(
            data.client_name
              ? { value: data.client_id, label: data.client_name }
              : null
          );
        }
        setMessage('');
        window.setTimeout(() => productInputRef.current?.focus(), 80);
        return;
      }
      await createNewCart({
        silent: true,
        prefsOverride: session,
        client_id: comptoirClientRef.current?.id || '',
      });
    } catch (e) {
      setBootError(apiErrorMessage(e, 'Impossible de reprendre la caisse'));
      setAwaitingCaisseOpen(true);
    } finally {
      setBooting(false);
      bootingRef.current = false;
    }
  }, [createNewCart]);

  const refreshCart = useCallback(async (id) => {
    if (finalizingCartIdRef.current === id) return null;
    try {
      const { data } = await api.get(`/sales/carts/${id}`);
      if (finalizingCartIdRef.current === id) return null;
      if (data.status === 'finalise' || data.status === 'annule') {
        if (data.status === 'finalise' && loadCaisseSession()?.open) {
          await prepareNextCart(`Vente ${data.cart_number} enregistrée`);
          return data;
        }
        returnToCaisseSetup(
          data.status === 'finalise'
            ? `Vente ${data.cart_number} enregistrée`
            : `Panier ${data.cart_number} annulé`
        );
        return data;
      }
      setCart(data);
      return data;
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Impossible de rafraîchir le panier'));
      return null;
    }
  }, [prepareNextCart]);

  useSocket((event, data) => {
    if (!cart || data?.id !== cart.id) return;
    if (event === 'cart:validated') {
      if (finalizingCartIdRef.current === data.id) return;
      if (loadCaisseSession()?.open) {
        prepareNextCart(`Vente ${data.cart_number || ''} enregistrée`);
      } else {
        returnToCaisseSetup(`Vente ${data.cart_number || ''} enregistrée`);
      }
      return;
    }
    if (event === 'cart:updated') {
      if (data.status === 'annule') {
        if (loadCaisseSession()?.open) {
          prepareNextCart(`Panier ${cart.cart_number} annulé`);
        } else {
          returnToCaisseSetup(`Panier ${cart.cart_number} annulé`);
        }
        return;
      }
      if (data.status === 'finalise' || finalizingCartIdRef.current === cart.id) return;
      refreshCart(cart.id);
    }
  });

  const patchCart = async (patch) => {
    if (!cart) return;
    setLoading(true);
    setMessage('');
    try {
      const { data } = await api.patch(`/sales/carts/${cart.id}`, patch);
      setCart(data);
      if (patch.sale_type) setPrefs((p) => ({ ...p, sale_type: patch.sale_type }));
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur mise à jour panier'));
    } finally {
      setLoading(false);
    }
  };

  const onClientChange = async (id, opt) => {
    setSelectedClient(opt);
    if (!cart) return;
    await patchCart({ client_id: id || null });
  };

  const selectComptoirClient = () => {
    if (!comptoirClient || !cart) return;
    onClientChange(String(comptoirClient.id), clientSelectOption(comptoirClient, user));
  };

  useEffect(() => {
    if (!cart || cart.client_id || !comptoirClient) return;
    if (comptoirAssignedRef.current === cart.id) return;
    comptoirAssignedRef.current = cart.id;
    const opt = clientSelectOption(comptoirClient, user);
    setSelectedClient(opt);
    patchCart({ client_id: comptoirClient.id });
  }, [cart?.id, cart?.client_id, comptoirClient]);

  const onSaleTypeChange = async (saleType) => {
    setPrefs((p) => ({ ...p, sale_type: saleType }));
    if (cart && !(cart.lines?.length > 0)) {
      await patchCart({ sale_type: saleType });
    }
  };

  const onProductChange = async (productId, opt) => {
    setSelectedProductOpt(opt || null);
    setLineForm((l) => ({ ...l, product_id: productId }));
    setStockInfo(null);
    setStockLoading(false);
    if (!productId || !cart) return;

    const saleType = prefsRef.current?.sale_type || prefs.sale_type || 'detail';
    const pvId = cart.delivery_point_id || prefsRef.current?.delivery_point_id || prefs.delivery_point_id;
    const raw = opt?.raw;

    if (raw) {
      const quickPrice = saleType === 'gros' ? raw.wholesale_price : raw.retail_price;
      if (quickPrice > 0) {
        setLineForm((l) => ({
          ...l,
          unit_price: String(quickPrice),
          quantity: l.quantity || 1,
        }));
      }
    }

    setStockLoading(true);
    const priceReq = api.get(`/sales/product-price/${productId}`, {
      params: {
        sale_type: saleType,
        ...(pvId ? { delivery_point_id: pvId } : {}),
      },
    });
    const stockReq = api.get(`/sales/carts/${cart.id}/stock/${productId}`);

    const [priceResult, stockResult] = await Promise.allSettled([priceReq, stockReq]);

    if (priceResult.status === 'fulfilled') {
      const unitPrice = priceResult.value.data?.unit_price;
      if (unitPrice > 0) {
        setLineForm((l) => ({
          ...l,
          unit_price: String(unitPrice),
          quantity: l.quantity || 1,
        }));
      }
    } else {
      setMessage((prev) => prev || apiErrorMessage(priceResult.reason, 'Prix produit indisponible'));
    }

    if (stockResult.status === 'fulfilled') {
      setStockInfo(stockResult.value.data);
    } else {
      setStockInfo(null);
      setMessage((prev) => prev || apiErrorMessage(stockResult.reason, 'Stock indisponible pour ce produit'));
    }
    setStockLoading(false);

    window.setTimeout(() => {
      quantityInputRef.current?.focus();
      quantityInputRef.current?.select?.();
    }, 30);
  };

  const resetLineForm = () => {
    setLineForm(emptyLine);
    setStockInfo(null);
    setSelectedProductOpt(null);
  };

  const addLine = async () => {
    if (!cart) return;
    if (!lineForm.product_id) {
      setMessage('Choisissez un produit');
      return;
    }
    const qty = parseNumberInput(lineForm.quantity);
    if (qty <= 0) {
      setMessage('Quantité invalide');
      return;
    }
    const discount = parseNumberInput(lineForm.discount || 0);
    const unitPrice = parseNumberInput(lineForm.unit_price);
    if (unitPrice <= 0) {
      setMessage('Saisissez le prix de vente');
      return;
    }
    if (discount > unitPrice + 0.0001) {
      setMessage('Remise trop élevée');
      return;
    }
    let freshStock = stockInfo;
    try {
      const { data } = await api.get(`/sales/carts/${cart.id}/stock/${lineForm.product_id}`);
      freshStock = data;
      setStockInfo(data);
    } catch {
      /* garde le dernier stock connu */
    }
    const dispo = effectiveStockDispo(freshStock);
    if (dispo != null && qty > dispo + 0.0001) {
      const reserved = parseFloat(freshStock?.reserved_others || 0);
      const magasin = parseFloat(freshStock?.available ?? freshStock?.total_stock ?? 0);
      setMessage(
        reserved > 0.005
          ? `Stock insuffisant : ${formatQty(dispo)} disponible(s) pour cette caisse (${formatQty(magasin)} en magasin, ${formatQty(reserved)} réservé(s) dans d'autres paniers ouverts)`
          : `Stock insuffisant (${formatQty(dispo)} disponible(s))`,
      );
      return;
    }
    if (store?.pos_confirm_add_line) {
      const product = selectedProductOpt?.raw;
      const ok = await confirm({
        title: 'Ajouter au panier',
        message: product
          ? `Ajouter ${formatQty(qty)} x « ${product.name} » au panier ?`
          : 'Ajouter cette ligne au panier ?',
        confirmLabel: 'Ajouter',
      });
      if (!ok) return;
    }
    setLineAdding(true);
    setMessage('');
    try {
      const { data } = await api.post(`/sales/carts/${cart.id}/lines`, {
        product_id: lineForm.product_id,
        unit_price: unitPrice,
        discount,
        quantity: qty,
      });
      if (data?.cart) {
        setCart(data.cart);
      } else {
        await refreshCart(cart.id);
      }
      resetLineForm();
      productInputRef.current?.focus();
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur ajout'));
    } finally {
      setLineAdding(false);
    }
  };

  const removeLine = async (lineId) => {
    if (!cart) return;
    const line = cart.lines?.find((l) => l.id === lineId);
    const ok = await confirm({
      title: 'Retirer la ligne',
      message: line
        ? `Retirer « ${line.product_name || line.name} » du panier ${cart.cart_number} ?`
        : 'Retirer cette ligne du panier ?',
      confirmLabel: 'Retirer',
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await api.delete(`/sales/carts/${cart.id}/lines/${lineId}`);
      await refreshCart(cart.id);
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur suppression ligne'));
    } finally {
      setLoading(false);
    }
  };

  const recordPayment = async () => {
    if (!cart) return;
    const installment = parseFloat(payment.amount_paid || 0);
    if (!installment || installment <= 0) {
      setMessage('Montant invalide');
      return;
    }
    const ok = await confirm({
      title: 'Enregistrer l\'encaissement',
      message: `Encaisser ${formatGNF(installment)} sur le panier ${cart.cart_number} ?`,
      confirmLabel: 'Encaisser',
    });
    if (!ok) return;
    setLoading(true);
    setMessage('');
    try {
      const { data } = await api.post(`/sales/carts/${cart.id}/payments`, payment);
      setMessage(data.message || 'Encaissement enregistré');
      setPayment({ amount_paid: '', payment_mode: payment.payment_mode });
      await refreshCart(cart.id);
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur encaissement'));
    } finally {
      setLoading(false);
    }
  };

  const setEncaisserMode = (encaisser) => {
    if (!allowReglementToggle && !encaisser) return;
    setEncaisserMaintenant(encaisser);
    if (!cart) return;
    const reste = balanceDueGnf(cart.total_amount, cart.amount_paid);
    if (encaisser && reste > 0) {
      setPayment((p) => ({ ...p, amount_paid: String(reste) }));
    } else if (!encaisser) {
      setPayment((p) => ({ ...p, amount_paid: '' }));
    }
  };

  const validateCartSale = async (opts = {}) => {
    const useAdvanceFlag = useClientAdvanceRef.current;
    const doEncaisse = opts.skipPayment ? false : (encaisserMaintenant || useAdvanceFlag);
    const pay = paymentRef.current;
    if (!cart || !(cart.lines?.length > 0)) {
      setMessage('Ajoutez au moins un produit');
      return;
    }
    if (loading || finalizingCartIdRef.current === cart.id) return;
    if (!cart.client_id) {
      setMessage('Sélectionnez un client avant de valider la vente');
      return;
    }
    let advanceBalanceNow = clientAdvanceBalance;
    if (useAdvanceFlag && cart.client_id) {
      try {
        const { data } = await api.get(`/sales/clients/${cart.client_id}/advance-balance`);
        advanceBalanceNow = parseFloat(data.advance_balance || 0);
        setClientAdvanceBalance(advanceBalanceNow);
      } catch {
        /* garde la dernière valeur connue */
      }
    }

    const total = roundGnf(cart.total_amount || 0);
    const paid = roundGnf(cart.amount_paid || 0);
    const reste = balanceDueGnf(total, paid);
    let pendingPay = doEncaisse ? roundGnf(parseNumberInput(pay.amount_paid || 0)) : 0;
    if (doEncaisse) {
      if (pendingPay > reste + 1) {
        setMessage(`Montant trop élevé — reste ${formatGNF(reste)}`);
        return;
      }
      const advanceOnly = useAdvanceFlag && advanceBalanceNow > 0.005 && pendingPay <= 0.005;
      if (allowReglementToggle && pendingPay <= 0 && !advanceOnly) {
        setMessage('Saisissez le montant à encaisser, cochez « Utiliser l\'avance client » ou choisissez « Encaisser plus tard »');
        return;
      }
      if (!allowReglementToggle && pendingPay <= 0 && !advanceOnly) {
        setMessage('Saisissez le montant à encaisser ou cochez « Utiliser l\'avance client »');
        return;
      }
      if (advanceOnly && advanceBalanceNow <= 0.005) {
        setMessage('Aucune avance disponible pour ce client');
        return;
      }
    }
    const advanceOnly = useAdvanceFlag && advanceBalanceNow > 0.005 && pendingPay <= 0.005;
    const advanceApplied = useAdvanceFlag && advanceBalanceNow > 0.005
      ? Math.min(reste, roundGnf(advanceBalanceNow))
      : 0;
    const totalCovered = advanceApplied + pendingPay;
    let confirmMessage;
    if (doEncaisse && (pendingPay > 0.005 || advanceOnly)) {
      if (advanceOnly) {
        confirmMessage = `Confirmer la vente ${cart.cart_number} et régler ${formatGNF(advanceApplied)} avec l'avance client ?`;
      } else if (advanceApplied > 0.005) {
        confirmMessage = isFullyPaidGnf(total, paid + totalCovered)
          ? `Confirmer la vente ${cart.cart_number} : ${formatGNF(advanceApplied)} sur l'avance + ${formatGNF(pendingPay)} en espèces ?`
          : `Vente ${cart.cart_number} : ${formatGNF(advanceApplied)} sur l'avance + ${formatGNF(pendingPay)} encaissés — reste ${formatGNF(reste - totalCovered)} à régler par la caisse.`;
      } else {
        confirmMessage = isFullyPaidGnf(total, paid + pendingPay)
          ? `Confirmer la vente ${cart.cart_number} et encaisser ${formatGNF(pendingPay)} ?`
          : `Encaissement partiel de ${formatGNF(pendingPay)} sur ${formatGNF(total)} — reste ${formatGNF(reste - pendingPay)} à régler par la caisse.`;
      }
    } else {
      confirmMessage = `Enregistrer la vente ${cart.cart_number} (${formatGNF(total)}) sans encaissement ? Le solde sera à régler par la caisse.`;
    }
    const ok = await confirm({
      title: doEncaisse && (pendingPay > 0.005 || advanceOnly) ? 'Valider et encaisser' : 'Valider la vente',
      message: confirmMessage,
      confirmLabel: 'Valider la vente',
    });
    if (!ok) return;
    setLoading(true);
    setMessage('');
    finalizingCartIdRef.current = cart.id;
    try {
      const payload = doEncaisse && (pendingPay > 0.005 || useAdvanceFlag)
        ? { amount_paid: pendingPay, payment_mode: pay.payment_mode, use_advance: useAdvanceFlag }
        : undefined;
      const { data } = await api.post(`/sales/carts/${cart.id}/validate`, payload || {});
      const resteApres = balanceDueGnf(total, data.amount_paid ?? paid);
      const suffix = !doEncaisse || resteApres > 0
        ? ` — reste ${formatGNF(data.balance_due ?? resteApres)}`
        : '';
      if (loadCaisseSession()?.open) {
        await prepareNextCart(`Vente ${data.cart_number} enregistrée${suffix}`);
      } else {
        returnToCaisseSetup(`Vente ${data.cart_number} enregistrée${suffix}`);
      }
    } catch (e) {
      finalizingCartIdRef.current = null;
      setMessage(apiErrorMessage(e, 'Erreur validation'));
    } finally {
      setLoading(false);
    }
  };

  const handlePayLater = () => validateCartSale({ skipPayment: true });

  const requestValidate = useCallback(() => {
    if (!cart || !(cart.lines?.length > 0)) {
      setMessage('Ajoutez au moins un produit');
      return;
    }
    if (loading || finalizingCartIdRef.current === cart.id) return;
    if (!cart.client_id) {
      setMessage('Sélectionnez un client avant de valider la vente');
      return;
    }
    validateCartSale();
  }, [cart, loading]);

  const cancelCart = async () => {
    if (!cart) return;
    const ok = await confirm({
      title: 'Annuler le panier',
      message: `Le panier ${cart.cart_number} et toutes ses lignes seront annulés. Cette action est irréversible.`,
      confirmLabel: 'Annuler le panier',
      cancelLabel: 'Retour',
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await api.post(`/sales/carts/${cart.id}/cancel`);
      if (loadCaisseSession()?.open) {
        await prepareNextCart(`Panier ${cart.cart_number} annulé`);
      } else {
        returnToCaisseSetup(`Panier ${cart.cart_number} annulé`);
      }
    } catch (e) {
      setMessage(apiErrorMessage(e, 'Erreur annulation'));
    } finally {
      setLoading(false);
    }
  };

  const quitCaisse = useCallback(async () => {
    if (cart?.lines?.length > 0) {
      const ok = await confirm({
        title: 'Quitter la caisse',
        message: `Le panier ${cart.cart_number} contient des articles. Quitter sans valider ? Le panier restera en cours.`,
        confirmLabel: 'Quitter',
        cancelLabel: 'Rester en caisse',
      });
      if (!ok) return;
    }
    clearCaisseSession();
    setCart(null);
    setAwaitingCaisseOpen(true);
    setBootError('');
    setMessage('');
    document.documentElement.classList.remove('app-caisse-active');
    navigate(pvLocked ? '/' : '/ventes', { replace: true });
  }, [cart, confirm, navigate, pvLocked]);

  useEffect(() => {
    if (!refsLoaded || authLoading || bootingRef.current || cart) return;
    const session = loadCaisseSession();
    if (!session?.open || String(session.userId) !== String(user?.id)) return;
    if (!session.delivery_point_id) return;
    if (!linkedEmployeeId) {
      clearCaisseSession();
      return;
    }
    if (String(session.seller_id) !== linkedEmployeeId) {
      clearCaisseSession();
    }
    const userPv = user?.delivery_point_id ? String(user.delivery_point_id) : '';
    if (pvLocked && userPv && String(session.delivery_point_id) !== userPv) {
      clearCaisseSession();
      setPrefs((p) => ({ ...p, delivery_point_id: userPv, seller_id: linkedEmployeeId }));
      return;
    }
    setPrefs((p) => ({
      ...p,
      seller_id: linkedEmployeeId,
      delivery_point_id: String(session.delivery_point_id),
      sale_type: session.sale_type || p.sale_type,
    }));
    resumeOrOpenCart({ ...session, seller_id: linkedEmployeeId });
  }, [refsLoaded, authLoading, user?.id, cart, resumeOrOpenCart, linkedEmployeeId, pvLocked, user?.delivery_point_id]);

  const openCaisse = async () => {
    const cartData = await createNewCart({ silent: true });
    if (cartData && user?.id) {
      saveCaisseSession({
        open: true,
        userId: user.id,
        seller_id: prefsRef.current.seller_id,
        delivery_point_id: prefsRef.current.delivery_point_id,
        sale_type: prefsRef.current.sale_type,
      });
    }
  };

  useEffect(() => {
    if (!cart || !encaisserMaintenant) return;
    const due = balanceDueGnf(cart.total_amount, cart.amount_paid);
    if (due <= 0) {
      setPayment((p) => (p.amount_paid ? { ...p, amount_paid: '' } : p));
      return;
    }
    const cashTarget = useClientAdvance
      ? Math.max(0, due - roundGnf(clientAdvanceBalance))
      : due;
    setPayment((p) => ({
      ...p,
      amount_paid: cashTarget > 0.005 ? String(Math.round(cashTarget)) : '',
    }));
  }, [cart?.id, cart?.total_amount, cart?.amount_paid, encaisserMaintenant, useClientAdvance, clientAdvanceBalance]);

  useEffect(() => {
    if (!cart?.client_id) {
      setClientAdvanceBalance(0);
      setUseClientAdvance(false);
      return;
    }
    setUseClientAdvance(false);
    api.get(`/sales/clients/${cart.client_id}/advance-balance`)
      .then(({ data }) => setClientAdvanceBalance(parseFloat(data.advance_balance || 0)))
      .catch(() => setClientAdvanceBalance(0));
  }, [cart?.client_id]);

  const handleUseAdvanceChange = useCallback((checked) => {
    setUseClientAdvance(checked);
    if (checked) setEncaisserMaintenant(true);
    if (!cart) return;
    const reste = balanceDueGnf(cart.total_amount, cart.amount_paid);
    const cashTarget = checked ? Math.max(0, reste - roundGnf(clientAdvanceBalance)) : reste;
    setPayment((p) => ({ ...p, amount_paid: cashTarget > 0.005 ? String(Math.round(cashTarget)) : '' }));
  }, [cart, clientAdvanceBalance]);

  const cartTotal = cart ? roundGnf(cart.total_amount || 0) : 0;
  const dejaEncaisse = cart ? roundGnf(cart.amount_paid || 0) : 0;
  const resteActuel = cart ? balanceDueGnf(cartTotal, dejaEncaisse) : 0;
  const hasLines = (cart?.lines?.length || 0) > 0;
  const hasClient = Boolean(cart?.client_id);
  const canValidate = hasLines && hasClient;

  const validateLabel = loading ? 'Traitement…' : 'Valider et encaisser';
  const linePreview = (parseFloat(lineForm.unit_price || 0) - parseFloat(lineForm.discount || 0)) * parseFloat(lineForm.quantity || 0);

  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.confirm-overlay')) return;
      if (e.key === 'F10' && cart && !awaitingCaisseOpen && canValidate && !loading) {
        e.preventDefault();
        requestValidate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, awaitingCaisseOpen, canValidate, loading, requestValidate]);

  const sellerHeaderLabel = cart?.seller_name || mySellerLabel;

  const currentPv = deliveryPoints.find(
    (dp) => String(dp.id) === String(cart?.delivery_point_id || prefs.delivery_point_id)
  );

  if ((authLoading || !refsLoaded || booting) && !cart) {
    return (
      <div className="pos-page pos-page--centered">
        <div className="vente-pos vente-pos--loading">
          <p>{booting ? 'Ouverture du panier…' : 'Chargement de la caisse…'}</p>
        </div>
      </div>
    );
  }

  if (!canUseCaisse && refsLoaded && !authLoading) {
    return (
      <div className="pos-page pos-page--centered pos-page--setup">
        <div className="vente-pos-setup vente-pos-setup--premium card">
          <Link to="/" className="vente-pos-setup__back">Retour</Link>
          <img src={logoSrc(store?.logo_url, store?.updated_at) || BRAND_LOGO} alt="" className="vente-pos-setup__logo" />
          <h3>Ouverture caisse</h3>
          <AlertBanner message={message || bootError} onClose={() => { setMessage(''); setBootError(''); }} />
          <p className="alert alert-warning vente-pos-setup__hint">
            Aucun employé lié à votre compte. Demandez à un administrateur de lier votre fiche employé pour utiliser la caisse.
          </p>
        </div>
      </div>
    );
  }

  if (!readyToSell || awaitingCaisseOpen) {
    const setupHint = awaitingCaisseOpen
      ? 'Cliquez sur « Ouvrir la caisse » pour démarrer votre session de vente.'
      : 'Point de livraison manquant — voir Paramètres.';

    return (
      <div className="pos-page pos-page--centered pos-page--setup">
        <div className="vente-pos-setup vente-pos-setup--premium card">
          <Link to="/" className="vente-pos-setup__back">Retour</Link>
          <img src={logoSrc(store?.logo_url, store?.updated_at) || BRAND_LOGO} alt="" className="vente-pos-setup__logo" />
          <h3>Ouverture caisse</h3>
          <AlertBanner message={message || bootError} onClose={() => { setMessage(''); setBootError(''); }} />
          <p className="vente-pos-setup__hint">{setupHint}</p>
          <div className="form-group vente-pos-setup__seller-readonly">
            <label>Vendeur</label>
            <p className="vente-pos-setup__seller-name">{mySellerLabel}</p>
          </div>
          {deliveryPoints.length > 0 ? (
            pvLocked ? (
              <div className="form-group">
                <label>Point de vente</label>
                <p className="vente-pos-setup__seller-name bmb-page-hint" style={{ margin: 0 }}>{myPvLabel}</p>
              </div>
            ) : (
              <div className="form-group">
                <label>Point de livraison</label>
                <select
                  value={prefs.delivery_point_id}
                  onChange={(e) => setPrefs((p) => ({ ...p, delivery_point_id: e.target.value }))}
                >
                  {deliveryPoints.map((dp) => (
                    <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <p className="alert alert-warning" style={{ marginTop: '1rem' }}>
              Aucun point de livraison — Paramètres.
            </p>
          )}
          <button
            type="button"
            className="vente-pos-setup__btn"
            disabled={!prefs.seller_id || !prefs.delivery_point_id || loading}
            onClick={openCaisse}
          >
            {loading ? 'Ouverture…' : 'Ouvrir la caisse'}
          </button>
        </div>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="pos-page pos-page--centered">
        <div className="vente-pos-setup card">
          <Link to="/" className="vente-pos-setup__back">Retour</Link>
          <h3>Panier indisponible</h3>
          <AlertBanner message={bootError || message} onClose={() => { setMessage(''); setBootError(''); }} />
          <p className="vente-pos-setup__hint">Le panier n&apos;a pas pu être créé. Vérifiez la connexion au serveur.</p>
          <button type="button" className="vente-pos-setup__btn" onClick={() => createNewCart({ silent: true })} disabled={loading}>
            {loading ? 'Réessai…' : 'Réessayer'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <VendrePosView
      message={message}
      onCloseMessage={() => setMessage('')}
      cart={cart}
      prefs={prefs}
      lineForm={lineForm}
      setLineForm={setLineForm}
      loading={loading}
      lineAdding={lineAdding}
      hasLines={hasLines}
      hasClient={hasClient}
      canValidate={canValidate}
      cartTotal={cartTotal}
      stockInfo={stockInfo}
      stockLoading={stockLoading}
      linePreview={linePreview}
      selectedClient={selectedClient}
      selectedProductOpt={selectedProductOpt}
      sellerHeaderLabel={sellerHeaderLabel}
      comptoirClient={comptoirClient}
      productInputRef={productInputRef}
      quantityInputRef={quantityInputRef}
      searchClients={searchClients}
      searchProducts={searchProducts}
      onClientChange={onClientChange}
      selectComptoirClient={selectComptoirClient}
      onSaleTypeChange={onSaleTypeChange}
      onProductChange={onProductChange}
      addLine={addLine}
      removeLine={removeLine}
      cancelCart={cancelCart}
      onRequestValidate={requestValidate}
      onPayLater={handlePayLater}
      createClientFromSearch={createClientFromSearch}
      allowReglementToggle={allowReglementToggle}
      showPayLater={showPayLater}
      payment={payment}
      setPayment={setPayment}
      useClientAdvance={useClientAdvance}
      setUseClientAdvance={handleUseAdvanceChange}
      clientAdvanceBalance={clientAdvanceBalance}
      dejaEncaisse={dejaEncaisse}
      resteActuel={resteActuel}
      validateLabel={validateLabel}
      onQuitCaisse={quitCaisse}
    />
    </>
  );
}
