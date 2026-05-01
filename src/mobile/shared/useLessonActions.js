import { useCallback } from 'react';
import {
  completeLessonApi,
  uncompleteLesson,
  changeLessonStatusApi,
  deleteLessonApi,
  createCashPayment,
  updateProductSaleApi,
  deleteProductSaleApi,
} from '../../api';

// Ders aksiyonlarını gruplayan stateless hook. Hem desktop LessonModal hem mobil
// MobileLessonModal aynı backend kontratını paylaşsın diye API katmanını
// ortaklaştırır. Submitting/error UI state'i çağıran komponentte kalır.
export function useLessonActions() {
  // completeLessonApi(id, { productSale? }) — ürün satışı complete ile birleşik
  const complete = useCallback(
    (lessonId, options = {}) => completeLessonApi(lessonId, options),
    []
  );

  const uncomplete = useCallback(
    (lessonId) => uncompleteLesson(lessonId),
    []
  );

  // reason: 'student' → status='cancelled' (geçmişte iptal kaydı kalır)
  //         'mistake' → kayıt tamamen silinir
  const cancel = useCallback((lessonId, reason) => {
    if (reason === 'mistake') return deleteLessonApi(lessonId);
    return changeLessonStatusApi(lessonId, 'cancelled');
  }, []);

  const addPayment = useCallback(
    (payload) => createCashPayment(payload),
    []
  );

  const updateSale = useCallback(
    (saleId, fields) => updateProductSaleApi(saleId, fields),
    []
  );

  const deleteSale = useCallback(
    (saleId) => deleteProductSaleApi(saleId),
    []
  );

  return { complete, uncomplete, cancel, addPayment, updateSale, deleteSale };
}
