import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import {
  searchEventStudents,
  getEventParticipants,
  createEventVehicle,
  addEventParticipant,
  assignEventParticipantVehicle,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { MobileEventPassengerPicker } from './MobileEventPassengerPicker';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR');
}

async function ensureParticipant(eventId, choice) {
  if (choice.participantId) return choice.participantId;
  const participant = await addEventParticipant(eventId, {
    ...(choice.studentId ? { studentId: choice.studentId } : { fullName: choice.fullName, phone: choice.phone || null }),
    role: 'regular',
    rsvpStatus: 'coming',
    transportMode: 'needs_vehicle',
  });
  return participant.id;
}

export function MobileEventAddVehicle({ eventId, onBack }) {
  const queryClient = useQueryClient();
  const [driverQuery, setDriverQuery] = React.useState('');
  const [driver, setDriver] = React.useState(null);
  const [seats, setSeats] = React.useState(4);
  const [passengers, setPassengers] = React.useState([]);
  const [passengerPickerOpen, setPassengerPickerOpen] = React.useState(false);
  const [meetingPlace, setMeetingPlace] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [vehicleCreatedWithError, setVehicleCreatedWithError] = React.useState(false);

  const searchResults = useQuery({
    queryKey: ['eventDriverSearch', eventId, driverQuery],
    queryFn: () => searchEventStudents(eventId, driverQuery),
    enabled: driverQuery.trim().length > 0 && !driver,
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.eventParticipants(eventId),
    queryFn: () => getEventParticipants(eventId),
  });
  const participants = participantsQuery.data ?? [];

  async function refreshTransport() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) }),
    ]);
  }

  function chooseDriver(nextDriver) {
    setDriver(nextDriver);
    if (nextDriver.studentId) {
      setPassengers((current) => current.filter((choice) => String(choice.studentId) !== String(nextDriver.studentId)));
    }
  }

  async function handleSubmit() {
    if (vehicleCreatedWithError) {
      onBack();
      return;
    }
    setError('');
    if (!driver) {
      setError('Şoför / araç sahibi seçin veya girin.');
      return;
    }
    if (!Number.isInteger(seats) || seats <= 0) {
      setError('Koltuk sayısı pozitif olmalı.');
      return;
    }
    if (passengers.length > seats) {
      setError('Seçilen yolcu sayısı koltuk sayısını geçemez.');
      return;
    }

    setSubmitting(true);
    let createdVehicle = null;
    try {
      createdVehicle = await createEventVehicle(eventId, {
        vehicleType: 'student_car',
        driverStudentId: driver.studentId ?? null,
        driverName: driver.studentId ? null : driver.name,
        driverPhone: driver.studentId ? null : (driver.phone || null),
        passengerSeats: seats,
        meetingTime: null,
        meetingPlace: meetingPlace.trim() || null,
        note: note.trim() || null,
      });

      for (const passenger of passengers) {
        const participantId = await ensureParticipant(eventId, passenger);
        await assignEventParticipantVehicle(participantId, createdVehicle.id);
      }

      await refreshTransport();
      onBack();
    } catch (err) {
      if (createdVehicle) {
        await refreshTransport();
        setVehicleCreatedWithError(true);
        setError('Araç eklendi ancak bazı yolcular eklenemedi. Ulaşım planından eksik kişileri tamamlayabilirsiniz.');
      } else {
        setError(err?.message || 'Araç eklenemedi.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (vehicleCreatedWithError) {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={onBack} aria-label="Ulaşım planına dön"><Icon.ChevronL width="22" height="22" /></button>
          <div className="evx-header-mid"><span className="evx-header-title">Yeni araç</span></div>
        </header>
        <div className="evx-body">
          <div className="evx-add-vehicle-result" role="alert">
            <span><Icon.Truck width="24" height="24" /></span>
            <strong>Araç oluşturuldu</strong>
            <p>{error}</p>
          </div>
        </div>
        <div className="evx-footer">
          <button type="button" className="evx-btn-primary" onClick={onBack}>Ulaşım planına dön</button>
        </div>
      </div>
    );
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} aria-label="Ulaşım planına dön"><Icon.ChevronL width="22" height="22" /></button>
        <div className="evx-header-mid"><span className="evx-header-title">Yeni araç</span></div>
      </header>

      <div className="evx-body evx-add-vehicle-body">
        <section className="evx-section">
          <span className="evx-section-label">Şoför / araç sahibi</span>
          {driver ? (
            <div className="evx-add-vehicle-driver">
              <span className="evx-avatar">{initialsOf(driver.name)}</span>
              <span>
                <strong>{driver.name}</strong>
                <small>{driver.studentId ? 'Kayıtlı öğrenci' : 'Dışarıdan şoför'}</small>
              </span>
              <button type="button" onClick={() => { setDriver(null); setDriverQuery(''); }}>Değiştir</button>
            </div>
          ) : (
            <>
              <label className="evx-passenger-search">
                <Icon.Search width="18" height="18" aria-hidden="true" />
                <input value={driverQuery} onChange={(event) => setDriverQuery(event.target.value)} placeholder="Şoförün adını yazın" aria-label="Şoför ara" />
              </label>
              {driverQuery.trim() && (
                <div className="evx-add-vehicle-driver-results">
                  {(searchResults.data ?? []).map((result) => (
                    <button key={result.id} type="button" onClick={() => chooseDriver({ studentId: result.id, name: result.full_name, phone: result.phone })}>
                      <span className="evx-avatar">{initialsOf(result.full_name)}</span>
                      <span><strong>{result.full_name}</strong><small>{result.phone || 'Kayıtlı öğrenci'}</small></span>
                      <span>Seç</span>
                    </button>
                  ))}
                  <button type="button" className="is-external" onClick={() => chooseDriver({ name: driverQuery.trim(), phone: '' })}>
                    <span className="evx-avatar"><Icon.Plus width="16" height="16" /></span>
                    <span><strong>“{driverQuery.trim()}” adlı dışarıdan şoför</strong><small>Öğrenci seçmeden devam et</small></span>
                    <span>Ekle</span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="evx-add-vehicle-seat-row" aria-labelledby="vehicle-seat-label">
          <span>
            <strong id="vehicle-seat-label">Yolcu koltuğu</strong>
            <small>Şoför hariç</small>
          </span>
          <div className="evx-add-vehicle-stepper" role="group" aria-label="Yolcu koltuğu sayısı">
            <button
              type="button"
              onClick={() => setSeats((current) => Math.max(Math.max(1, passengers.length), current - 1))}
              disabled={seats <= Math.max(1, passengers.length)}
              aria-label="Koltuk sayısını azalt"
            >−</button>
            <output aria-live="polite">{seats}</output>
            <button type="button" onClick={() => setSeats((current) => current + 1)} aria-label="Koltuk sayısını artır">+</button>
          </div>
        </section>

        <section className="evx-section">
          <div className="evx-add-vehicle-section-head">
            <span>
              <strong>Yolcular</strong>
              <small>{passengers.length > 0 ? `${passengers.length}/${seats} koltuk seçildi` : 'Araçla birlikte ekleyebilirsiniz'}</small>
            </span>
            {passengers.length > 0 && <span className="evx-pill tone-neutral">{passengers.length} kişi</span>}
          </div>

          {passengers.length > 0 && (
            <div className="evx-add-vehicle-passengers">
              {passengers.map((passenger) => (
                <div key={passenger.key}>
                  <span className="evx-passenger-avatar">{initialsOf(passenger.name)}</span>
                  <span><strong>{passenger.name}</strong><small>{passenger.source === 'external' ? 'Dışarıdan kişi' : 'Öğrenci'}</small></span>
                  <button
                    type="button"
                    onClick={() => setPassengers((current) => current.filter((choice) => choice.key !== passenger.key))}
                    aria-label={`${passenger.name} yolcu seçiminden çıkar`}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {passengers.length < seats ? (
            <button type="button" className={`evx-add-passenger-cta${passengers.length === 0 ? ' is-empty' : ''}`} onClick={() => setPassengerPickerOpen(true)}>
              <span><Icon.Plus width="18" height="18" /></span>
              <span>
                <strong>{passengers.length === 0 ? 'Yolcu ekle' : 'Başka yolcu ekle'}</strong>
                <small>Öğrencilerden seçin veya dışarıdan kişi ekleyin</small>
              </span>
              <Icon.ChevronR width="18" height="18" aria-hidden="true" />
            </button>
          ) : (
            <p className="evx-add-vehicle-limit">Tüm yolcu koltukları seçildi.</p>
          )}
        </section>

        <label className="evx-field">
          <span className="evx-field-label">Buluşma yeri</span>
          <input value={meetingPlace} onChange={(event) => setMeetingPlace(event.target.value)} placeholder="İsteğe bağlı" />
        </label>

        <label className="evx-field">
          <span className="evx-field-label">Not</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="İsteğe bağlı…" rows={2} />
        </label>

        {error && <div className="evx-add-vehicle-error" role="alert">{error}</div>}
      </div>

      <div className="evx-footer">
        <button type="button" className="evx-btn-primary" onClick={handleSubmit} disabled={submitting}>
          <Icon.Plus width="16" height="16" />
          {submitting ? 'Ekleniyor…' : passengers.length > 0 ? `Aracı ve ${passengers.length} yolcuyu ekle` : 'Aracı ekle'}
        </button>
      </div>

      <MobileEventPassengerPicker
        open={passengerPickerOpen}
        eventId={eventId}
        participants={participants}
        value={passengers}
        max={seats}
        title="Araca yolcu ekle"
        excludedStudentIds={driver?.studentId ? [driver.studentId] : []}
        onClose={() => setPassengerPickerOpen(false)}
        onConfirm={(nextPassengers) => { setPassengers(nextPassengers); setPassengerPickerOpen(false); }}
      />
    </div>
  );
}
