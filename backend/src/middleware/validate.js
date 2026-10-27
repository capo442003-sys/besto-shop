function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toObject(input) {
  if (!isPlainObject(input)) return {};
  return input;
}

export function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const payload = toObject(req.body);
    const result = schema(payload);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    req.body = result.value;
    return next();
  };
}

export function readTrimmedString(
  source,
  field,
  {
    required = false,
    min = 0,
    max = 500,
    label = field,
  } = {}
) {
  const raw = source[field];
  if (raw == null || raw === '') {
    if (required) return { error: `${label} requis` };
    return { value: undefined };
  }
  if (typeof raw !== 'string') return { error: `${label} invalide` };
  const value = raw.trim();
  if (required && !value) return { error: `${label} requis` };
  if (value.length < min) return { error: `${label} invalide` };
  if (value.length > max) return { error: `${label} invalide` };
  return { value };
}

export function readPositiveInt(
  source,
  field,
  {
    required = false,
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
    label = field,
  } = {}
) {
  const raw = source[field];
  if (raw == null || raw === '') {
    if (required) return { error: `${label} requis` };
    return { value: undefined };
  }
  const num = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(num) || num < min || num > max) {
    return { error: `${label} invalide` };
  }
  return { value: num };
}

export function readBoolean(
  source,
  field,
  {
    required = false,
    label = field,
  } = {}
) {
  const raw = source[field];
  if (raw == null || raw === '') {
    if (required) return { error: `${label} requis` };
    return { value: undefined };
  }
  if (typeof raw === 'boolean') return { value: raw };
  if (raw === 1 || raw === '1' || raw === 'true') return { value: true };
  if (raw === 0 || raw === '0' || raw === 'false') return { value: false };
  return { error: `${label} invalide` };
}

/** Interprète use_advance / flags depuis JSON ou formulaires */
export function coerceBoolean(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return false;
}

export function readEnum(
  source,
  field,
  values,
  {
    required = false,
    label = field,
  } = {}
) {
  const parsed = readTrimmedString(source, field, { required, min: 1, max: 80, label });
  if (parsed.error || parsed.value === undefined) return parsed;
  if (!values.includes(parsed.value)) return { error: `${label} invalide` };
  return { value: parsed.value };
}

export function readAmount(
  source,
  field,
  {
    required = false,
    min = 0,
    max = 1_000_000_000_000,
    label = field,
  } = {}
) {
  const raw = source[field];
  if (raw == null || raw === '') {
    if (required) return { error: `${label} requis` };
    return { value: undefined };
  }
  const num = Number.parseFloat(String(raw));
  if (!Number.isFinite(num) || num < min || num > max) {
    return { error: `${label} invalide` };
  }
  return { value: num };
}
