export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);

    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: true,
      });
    }
  }
}

export class OverpaymentOnPrepaidPackageError extends AppError {
  constructor(message = "Prepaid package payments must match the package total exactly.") {
    super("OVERPAYMENT_ON_PREPAID_PACKAGE", message, 409);
  }
}

export class OverpaymentNotAllowedError extends AppError {
  constructor(message = "Ödeme tutarı kalan ödenecek tutarı aşamaz.") {
    super("OVERPAYMENT_NOT_ALLOWED", message, 409);
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(message = "Invalid lesson status transition.") {
    super("INVALID_STATUS_TRANSITION", message, 409);
  }
}

export class PaymentTargetMismatchError extends AppError {
  constructor(message = "Payment target does not satisfy the required business rules.") {
    super("PAYMENT_TARGET_MISMATCH", message, 409);
  }
}

export class PackagePaymentDeleteForbiddenError extends AppError {
  constructor(message = "Cannot delete a payment bound to an active prepaid package.") {
    super("PACKAGE_PAYMENT_DELETE_FORBIDDEN", message, 409);
  }
}

export class PackageHasUsedCreditsError extends AppError {
  constructor(message = "Package has used credits and cannot be deleted.") {
    super("PACKAGE_HAS_USED_CREDITS", message, 409);
  }
}

export class CurrencyMismatchError extends AppError {
  constructor(message = "Currency mismatch between related records.") {
    super("CURRENCY_MISMATCH", message, 409);
  }
}

export class StudentNotFoundError extends AppError {
  constructor(message = "Student not found.") {
    super("STUDENT_NOT_FOUND", message, 404);
  }
}

export class LessonNotFoundError extends AppError {
  constructor(message = "Lesson not found.") {
    super("LESSON_NOT_FOUND", message, 404);
  }
}

export class ProductSaleNotFoundError extends AppError {
  constructor(message = "Product sale not found.") {
    super("PRODUCT_SALE_NOT_FOUND", message, 404);
  }
}

export class PrepaidPackageNotFoundError extends AppError {
  constructor(message = "Prepaid package not found.") {
    super("PREPAID_PACKAGE_NOT_FOUND", message, 404);
  }
}

export class PaymentNotFoundError extends AppError {
  constructor(message = "Payment not found.") {
    super("PAYMENT_NOT_FOUND", message, 404);
  }
}

export class DeleteConflictError extends AppError {
  constructor(message = "This record cannot be deleted while dependent records exist.") {
    super("DELETE_CONFLICT", message, 409);
  }
}

export class CalendarEventNotFoundError extends AppError {
  constructor(message = "Calendar event not found.") {
    super("CALENDAR_EVENT_NOT_FOUND", message, 404);
  }
}

export class EventNotFoundError extends AppError {
  constructor(message = "Etkinlik bulunamadı.") {
    super("EVENT_NOT_FOUND", message, 404);
  }
}

export class EventParticipantNotFoundError extends AppError {
  constructor(message = "Etkinlik katılımcısı bulunamadı.") {
    super("EVENT_PARTICIPANT_NOT_FOUND", message, 404);
  }
}

export class EventFeeItemNotFoundError extends AppError {
  constructor(message = "Etkinlik ücret kalemi bulunamadı.") {
    super("EVENT_FEE_ITEM_NOT_FOUND", message, 404);
  }
}

export class EventVehicleNotFoundError extends AppError {
  constructor(message = "Etkinlik aracı bulunamadı.") {
    super("EVENT_VEHICLE_NOT_FOUND", message, 404);
  }
}

export class DuplicateParticipantError extends AppError {
  constructor(message = "Bu öğrenci etkinliğin katılımcı listesinde zaten var.") {
    super("DUPLICATE_PARTICIPANT", message, 409);
  }
}

export class CompQuotaExceededError extends AppError {
  constructor(message = "Bu ücret kaleminin ücretsiz kontenjanı dolu.") {
    super("COMP_QUOTA_EXCEEDED", message, 409);
  }
}

export class VehicleFullError extends AppError {
  constructor(message = "Bu araçta boş yolcu koltuğu kalmadı.") {
    super("VEHICLE_FULL", message, 409);
  }
}

export class EventHasPaymentsError extends AppError {
  constructor(
    message = "Bu etkinlikte aktif tahsilat var; iade edip tahsilat kayıtlarını iptal etmeden etkinlik silinemez.",
  ) {
    super("EVENT_HAS_PAYMENTS", message, 409);
  }
}

export class EventVehicleHasPassengersError extends AppError {
  constructor(message = "Araçta yolcu varken araç silinemez; önce yolcuların ulaşım durumunu değiştirin.") {
    super("EVENT_VEHICLE_HAS_PASSENGERS", message, 409);
  }
}

export class EventPaymentNotFoundError extends AppError {
  constructor(message = "Etkinlik tahsilatı bulunamadı.") {
    super("EVENT_PAYMENT_NOT_FOUND", message, 404);
  }
}

export class ReauthenticationFailedError extends AppError {
  constructor(message = "Mevcut hesap şifresi doğrulanamadı.") {
    super("REAUTHENTICATION_FAILED", message, 403);
  }
}

export class EventParticipantHasPaymentsError extends AppError {
  constructor(
    message = "Bu katılımcının aktif tahsilatı var; iade edip tahsilatı iptal etmeden listeden kaldırılamaz.",
  ) {
    super("EVENT_PARTICIPANT_HAS_PAYMENTS", message, 409);
  }
}

export class EventParticipantHasGuestsError extends AppError {
  constructor(
    message = "Bu kişinin misafirleri var; önce onları kaldırın ya da bağlantısını değiştirin.",
  ) {
    super("EVENT_PARTICIPANT_HAS_GUESTS", message, 409);
  }
}

// Notlar 0273'te etkinlikten koparıldı (tek genel not alanı) — hata adları da
// artık etkinlik önekini taşımaz; bkz. notes.service.ts.
export class NoteNotFoundError extends AppError {
  constructor(message = "Not bulunamadı.") {
    super("NOTE_NOT_FOUND", message, 404);
  }
}

export class NoteForbiddenError extends AppError {
  constructor(message = "Yalnızca kendi notunuzu düzenleyebilir veya silebilirsiniz.") {
    super("NOTE_FORBIDDEN", message, 403);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input.") {
    super("VALIDATION_ERROR", message, 400);
  }
}

export class LessonConflictError extends AppError {
  constructor(message = "This time slot conflicts with an existing lesson.") {
    super("LESSON_CONFLICT", message, 409);
  }
}

export class CalendarEventConflictError extends AppError {
  constructor(message = "This time slot conflicts with an existing calendar event.") {
    super("CALENDAR_EVENT_CONFLICT", message, 409);
  }
}

export class DiscountNotAllowedError extends AppError {
  constructor(message = "Discount cannot be applied to this lesson.") {
    super("DISCOUNT_NOT_ALLOWED", message, 409);
  }
}

export class DiscountWouldExceedNetError extends AppError {
  constructor(
    message = "Applying this discount would leave the paid amount above the net due; reduce payments first or lower the discount.",
  ) {
    super("DISCOUNT_WOULD_EXCEED_NET", message, 409);
  }
}

export class UserNotFoundError extends AppError {
  constructor(message = "Kullanıcı bulunamadı.") {
    super("USER_NOT_FOUND", message, 404);
  }
}

export class UsernameTakenError extends AppError {
  constructor(message = "Bu kullanıcı adı zaten kullanılıyor.") {
    super("USERNAME_TAKEN", message, 409);
  }
}

export class SelfUpdateForbiddenError extends AppError {
  constructor(message = "Kendi hesabını devre dışı bırakamaz veya rolünü düşüremezsin.") {
    super("SELF_UPDATE_FORBIDDEN", message, 409);
  }
}

export class LastOwnerError extends AppError {
  constructor(
    message = "Son aktif Geliştirici hesabı devre dışı bırakılamaz veya rolü değiştirilemez.",
  ) {
    super("LAST_OWNER", message, 409);
  }
}

type PgLikeError = {
  code?: string;
  constraint?: string;
  message?: string;
};

function isPgLikeError(error: unknown): error is PgLikeError {
  return typeof error === "object" && error !== null && "message" in error;
}

export function toServiceError(error: unknown): Error {
  if (error instanceof AppError) {
    return error;
  }

  if (!isPgLikeError(error)) {
    return error instanceof Error ? error : new Error("Unknown service error.");
  }

  const constraint = error.constraint ?? "";
  const message = error.message ?? "";

  switch (constraint) {
    case "ux_payments_one_active_per_package":
      return new OverpaymentOnPrepaidPackageError(
        "Prepaid packages can only have one active payment.",
      );
    case "chk_prepaid_total_equals_credits_times_unit":
      return new OverpaymentOnPrepaidPackageError(
        "Prepaid package total_amount must equal credit_count × unit_price.",
      );
    case "chk_payments_prepaid_source":
      return new PaymentTargetMismatchError(
        "Prepaid packages can only be purchased with cash or iban.",
      );
    case "chk_payments_single_target":
      return new PaymentTargetMismatchError("Payments must target exactly one entity.");
    case "chk_lessons_prepaid_only_completed":
      return new InvalidStatusTransitionError(
        "A lesson can reference a prepaid package only when it is completed.",
      );
    case "chk_lessons_discount_nonneg":
    case "chk_lessons_discount_le_price":
      return new ValidationError(
        "discount_amount must be between 0 and the lesson price_snapshot.",
      );
    case "chk_lessons_prepaid_no_discount":
      return new DiscountNotAllowedError(
        "Discount cannot be applied to a lesson covered by a prepaid package.",
      );
    case "users_username_key":
      return new UsernameTakenError();
    case "event_participants_event_id_student_id_key":
      return new DuplicateParticipantError();
    default:
      break;
  }

  if (message.includes("Payment target lesson not found or deleted")) {
    return new LessonNotFoundError("Payment target lesson not found.");
  }

  if (message.includes("Payment target product_sale not found or deleted")) {
    return new ProductSaleNotFoundError("Payment target product sale not found.");
  }

  if (message.includes("Payment target prepaid_package not found or deleted")) {
    return new PrepaidPackageNotFoundError("Payment target prepaid package not found.");
  }

  if (message.includes("Payment allowed only on completed lesson")) {
    return new PaymentTargetMismatchError("Payments are only allowed on completed lessons.");
  }

  if (message.includes("Credit-covered lesson has no debt")) {
    return new PaymentTargetMismatchError(
      "Credit-covered lessons are already settled and cannot receive payments.",
    );
  }

  if (message.includes("Prepaid package not found or deleted")) {
    return new PrepaidPackageNotFoundError();
  }

  if (message.includes("Package student mismatch")) {
    return new PaymentTargetMismatchError(
      "The prepaid package belongs to a different student.",
    );
  }

  if (message.includes("Cannot soft-delete payment bound to active prepaid_package")) {
    return new PackagePaymentDeleteForbiddenError();
  }

  if (message.includes("Currency mismatch")) {
    return new CurrencyMismatchError(message);
  }

  return error instanceof Error ? error : new Error("Unknown service error.");
}
