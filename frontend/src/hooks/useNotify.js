import { useCallback, useMemo } from 'react';
import { useToast } from '../context/ToastContext';
import { apiErrorMessage } from '../utils/apiError';

export function useNotify() {
  const { success, error, info } = useToast();

  const apiError = useCallback(
    (err, fallback) => error(apiErrorMessage(err, fallback)),
    [error]
  );
  const apiSuccess = useCallback((msg) => success(msg), [success]);

  return useMemo(
    () => ({ success, error, info, apiError, apiSuccess }),
    [success, error, info, apiError, apiSuccess]
  );
}