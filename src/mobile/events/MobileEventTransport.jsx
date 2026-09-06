import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Drawer } from 'vaul';
import { Icon } from '../../layout';
import {
  getEventById,
  getEventParticipants,
  getEventVehicles,
  addEventParticipant,
  assignEventParticipantVehicle,
  updateEventParticipant,
  updateEventVehicle,
  deleteEventVehicle,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { MobileToast } from '../MobileToast';
import { MobileEventPassengerPicker } from './MobileEventPassengerPicker';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function nameOf(participant) {
  return participant.student_nickname || participant.student_name || 'İsimsiz';
}

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR');
}

function driverOf(vehicle, participants) {
  const driver = participants.find((participant) => String(participant.student_id) === String(vehicle.driver_student_id));
  return vehicle.driver_name || driver?.student_name || vehicle.driver_student_name || 'Şoför';
}

function meetingOf(vehicle) {
  return vehicle.meeting_place || '';
}

function seatsOf(vehicle) {
  const total = Number(vehicle.passenger_seats) || 0;
  const taken = Number(vehicle.seats_taken) || 0;
  return { total, taken, available: Math.max(0, total - taken) };
}

function SeatDots({ driverName, total, taken, available }) {
  return (
    <div className="evx-transport-seat-map">
      <div
        className="evx-transport-seat-dots"
        role="img"
        aria-label={`${driverName} aracında ${taken} dolu, ${available} boş yolcu koltuğu`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`evx-transport-seat-dot${index < taken ? ' is-filled' : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <span>{taken} yolcu · {available} boş</span>
    </div>
  );
}

function VehiclePicker({ participant, participants, vehicles, assigning, error, onAssign, onSetMode, onClose, onAddVehicle }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const currentVehicleId = participant?.vehicle_id == null ? null : String(participant.vehicle_id);
  const orderedVehicles = React.useMemo(() => [...vehicles].sort((a, b) => {
    if (String(a.id) === currentVehicleId) return -1;
    if (String(b.id) === currentVehicleId) return 1;
    return Number(seatsOf(a).available === 0) - Number(seatsOf(b).available === 0);
  }), [currentVehicleId, vehicles]);

  return (
    <Drawer.Root
      open={!!participant}
      onOpenChange={(open) => { if (!open && !assigning) onClose(); }}
      dismissible={!assigning}
      shouldScaleBackground={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="evx-transport-overlay" />
        <Drawer.Content className="evx-transport-sheet" aria-busy={assigning}>
          <Drawer.Handle className="evx-transport-sheet-handle" />
          <header className="evx-transport-sheet-head">
            <Drawer.Title className="evx-transport-sheet-title">
              {participant ? `${nameOf(participant)} için araç seç` : 'Araç seç'}
            </Drawer.Title>
            <Drawer.Description className="evx-transport-sheet-sub">
              Boş koltuğu olan bir araca dokunun.
            </Drawer.Description>
          </header>

          <div className="evx-transport-sheet-body">
            <div className="evx-choice" style={{ marginBottom: 12 }}>
              {[
                ['needs_vehicle', 'Araç bekliyor'],
                ['self_arranged', 'Kendi geliyor'],
                ['unspecified', 'Belirsiz'],
              ].map(([mode, label]) => (
                <button key={mode} type="button" className={`evx-choice-btn${participant?.transport_mode === mode && !participant?.vehicle_id ? ' is-on' : ''}`}
                  disabled={assigning} onClick={() => onSetMode(mode)}>{label}</button>
              ))}
            </div>
            {vehicles.length === 0 ? (
              <div className="evx-transport-sheet-empty">
                <span className="evx-transport-sheet-empty-icon"><Icon.Truck width="22" height="22" /></span>
                <strong>Önce bir araç ekleyin</strong>
                <span>Şoför ve koltuk bilgisi eklendiğinde kişiyi yerleştirebilirsiniz.</span>
                <button
                  type="button"
                  className="evx-btn-primary"
                  onClick={() => { onClose(); onAddVehicle(); }}
                >
                  <Icon.Plus width="16" height="16" /> Araç ekle
                </button>
              </div>
            ) : (
              <div className="evx-transport-options">
                {orderedVehicles.map((vehicle) => {
                  const driver = driverOf(vehicle, participants);
                  const meeting = meetingOf(vehicle);
                  const { total, taken, available } = seatsOf(vehicle);
                  const current = currentVehicleId === String(vehicle.id);
                  const full = available === 0;
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      className={`evx-transport-option${current ? ' is-current' : ''}`}
                      disabled={assigning || current || full}
                      onClick={() => onAssign(vehicle.id)}
                    >
                      <span className="evx-transport-option-icon"><Icon.Truck width="18" height="18" /></span>
                      <span className="evx-transport-option-copy">
                        <strong>{driver}</strong>
                        <span>{meeting || `${total} yolcu koltuğu`}</span>
                      </span>
                      <span className={`evx-transport-seat-badge${full ? ' is-full' : ''}${current ? ' is-current' : ''}`}>
                        {current ? 'Mevcut' : full ? 'Dolu' : `${available} boş`}
                      </span>
                      <span className="evx-transport-option-capacity">{taken}/{total}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {error && <p className="evx-transport-error" role="alert">{error}</p>}
          </div>

          <footer className="evx-transport-sheet-footer">
            <button type="button" className="evx-btn-secondary" disabled={assigning} onClick={onClose}>
              Vazgeç
            </button>
          </footer>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MobileEventTransport({ eventId, onBack, onOpenAddVehicle }) {
  const queryClient = useQueryClient();
  const [selectedParticipantId, setSelectedParticipantId] = React.useState(null);
  const [assigning, setAssigning] = React.useState(false);
  const [assignmentError, setAssignmentError] = React.useState('');
  const [passengerVehicleId, setPassengerVehicleId] = React.useState(null);
  const [passengerSubmitting, setPassengerSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [editingVehicleId, setEditingVehicleId] = React.useState(null);
  const [vehicleDraft, setVehicleDraft] = React.useState(null);
  const [vehicleBusy, setVehicleBusy] = React.useState(false);
  const [vehicleError, setVehicleError] = React.useState('');

  const eventQuery = useQuery({
    queryKey: queryKeys.eventById(eventId),
    queryFn: () => getEventById(eventId),
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.eventParticipants(eventId),
    queryFn: () => getEventParticipants(eventId),
  });
  const vehiclesQuery = useQuery({
    queryKey: queryKeys.eventVehicles(eventId),
    queryFn: () => getEventVehicles(eventId),
  });

  const event = eventQuery.data;
  const participants = participantsQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const selectedParticipant = participants.find((participant) => String(participant.id) === String(selectedParticipantId)) ?? null;
  const passengerVehicle = vehicles.find((vehicle) => String(vehicle.id) === String(passengerVehicleId)) ?? null;
  const driverStudentIds = new Set(vehicles.map((vehicle) => vehicle.driver_student_id).filter(Boolean).map(String));
  const isRegisteredDriver = (participant) => driverStudentIds.has(String(participant.student_id));

  const waiting = participants.filter((participant) => participant.transport_mode === 'needs_vehicle' && !participant.vehicle_id && !isRegisteredDriver(participant));
  const selfArranged = participants.filter((participant) => participant.transport_mode === 'self_arranged' && !isRegisteredDriver(participant));
  const unspecified = participants.filter((participant) => participant.transport_mode === 'unspecified' && !isRegisteredDriver(participant));
  const loading = eventQuery.isLoading || participantsQuery.isLoading || vehiclesQuery.isLoading;
  const failed = eventQuery.isError || participantsQuery.isError || vehiclesQuery.isError;

  function openVehiclePicker(participantId) {
    setAssignmentError('');
    setSelectedParticipantId(participantId);
  }

  function closeVehiclePicker() {
    if (assigning) return;
    setSelectedParticipantId(null);
    setAssignmentError('');
  }

  async function assignToVehicle(vehicleId) {
    if (!selectedParticipant) return;
    setAssigning(true);
    setAssignmentError('');
    const participantName = nameOf(selectedParticipant);
    try {
      await assignEventParticipantVehicle(selectedParticipant.id, vehicleId);
      queryClient.setQueryData(queryKeys.eventParticipants(eventId), (current) => (
        Array.isArray(current)
          ? current.map((participant) => (
            String(participant.id) === String(selectedParticipant.id)
              ? { ...participant, transport_mode: 'needs_vehicle', vehicle_id: vehicleId }
              : participant
          ))
          : current
      ));
      setSelectedParticipantId(null);
      setToast(`${participantName} araca yerleştirildi.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) }),
      ]);
    } catch (error) {
      setAssignmentError(error?.message || 'Kişi araca yerleştirilemedi.');
    } finally {
      setAssigning(false);
    }
  }

  async function setTransportMode(mode) {
    if (!selectedParticipant) return;
    setAssigning(true);
    setAssignmentError('');
    const participantName = nameOf(selectedParticipant);
    try {
      await updateEventParticipant(selectedParticipant.id, { transportMode: mode });
      setSelectedParticipantId(null);
      setToast(`${participantName} ulaşım durumu güncellendi.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) }),
      ]);
    } catch (error) {
      setAssignmentError(error?.message || 'Ulaşım durumu güncellenemedi.');
    } finally {
      setAssigning(false);
    }
  }

  function openPassengerPicker(vehicleId) {
    setPassengerVehicleId(vehicleId);
  }

  function closePassengerPicker() {
    if (passengerSubmitting) return;
    setPassengerVehicleId(null);
  }

  async function ensureParticipant(choice) {
    if (choice.participantId) return choice.participantId;
    const participant = await addEventParticipant(eventId, {
      ...(choice.studentId ? { studentId: choice.studentId } : { fullName: choice.fullName, phone: choice.phone || null }),
      role: 'regular',
      rsvpStatus: 'coming',
      transportMode: 'needs_vehicle',
    });
    return participant.id;
  }

  async function addPassengersToVehicle(choices) {
    if (!passengerVehicle || choices.length === 0) return;
    setPassengerSubmitting(true);
    let completed = 0;
    try {
      for (const choice of choices) {
        const participantId = await ensureParticipant(choice);
        await assignEventParticipantVehicle(participantId, passengerVehicle.id);
        completed += 1;
      }
      setPassengerVehicleId(null);
      setToast(`${completed} yolcu araca eklendi.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) }),
      ]);
    } catch (error) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) }),
      ]);
      setPassengerVehicleId(null);
      setToast(completed > 0
        ? `${completed} yolcu eklendi; kalan yolcular eklenemedi.`
        : error?.message || 'Yolcular araca eklenemedi.');
    } finally {
      setPassengerSubmitting(false);
    }
  }

  async function sharePlan() {
    const lines = [`${event?.name ?? 'Etkinlik'} — Ulaşım planı`, ''];
    for (const vehicle of vehicles) {
      const riders = participants.filter((participant) => String(participant.vehicle_id) === String(vehicle.id)).map(nameOf);
      const { total, taken } = seatsOf(vehicle);
      lines.push(`${driverOf(vehicle, participants)} · ${taken}/${total} yolcu`);
      if (meetingOf(vehicle)) lines.push(`Buluşma: ${meetingOf(vehicle)}`);
      lines.push(`Yolcular: ${riders.join(', ') || 'Henüz yok'}`, '');
    }
    if (waiting.length > 0) lines.push(`Araç bekleyenler: ${waiting.map(nameOf).join(', ')}`);
    if (selfArranged.length > 0) lines.push(`Kendi gelenler: ${selfArranged.map(nameOf).join(', ')}`);
    if (unspecified.length > 0) lines.push(`Ulaşımı seçilmemiş: ${unspecified.map(nameOf).join(', ')}`);
    const text = lines.join('\n').trim();

    try {
      if (navigator.share) {
        await navigator.share({ title: 'Ulaşım planı', text });
        setToast('Ulaşım planı paylaşıldı.');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setToast('Ulaşım planı panoya kopyalandı.');
      } else {
        setToast('Bu cihazda paylaşım kullanılamıyor.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setToast('Plan paylaşılamadı.');
    }
  }

  function startVehicleEdit(vehicle) {
    setVehicleError('');
    setEditingVehicleId(vehicle.id);
    setVehicleDraft({
      driverName: vehicle.driver_name || '',
      driverPhone: vehicle.driver_phone || '',
      passengerSeats: String(vehicle.passenger_seats),
      meetingPlace: vehicle.meeting_place || '',
      note: vehicle.note || '',
    });
  }

  async function saveVehicle(vehicle) {
    const passengerSeats = Number(vehicleDraft?.passengerSeats);
    if (!Number.isInteger(passengerSeats) || passengerSeats < Number(vehicle.seats_taken || 0) || passengerSeats <= 0) {
      setVehicleError(`Koltuk sayısı en az ${Math.max(1, Number(vehicle.seats_taken || 0))} olmalıdır.`);
      return;
    }
    setVehicleBusy(true);
    setVehicleError('');
    try {
      await updateEventVehicle(vehicle.id, {
        ...(!vehicle.driver_student_id ? { driverName: vehicleDraft.driverName.trim() } : {}),
        driverPhone: vehicleDraft.driverPhone.trim() || null,
        passengerSeats,
        meetingPlace: vehicleDraft.meetingPlace.trim() || null,
        note: vehicleDraft.note.trim() || null,
      });
      setEditingVehicleId(null);
      setVehicleDraft(null);
      setToast('Araç bilgileri güncellendi.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) });
    } catch (error) {
      setVehicleError(error?.message || 'Araç güncellenemedi.');
    } finally {
      setVehicleBusy(false);
    }
  }

  async function removeVehicle(vehicle) {
    if (!window.confirm(`${driverOf(vehicle, participants)} aracı silinsin mi?`)) return;
    setVehicleBusy(true);
    setVehicleError('');
    try {
      await deleteEventVehicle(vehicle.id);
      setEditingVehicleId(null);
      setVehicleDraft(null);
      setToast('Araç silindi.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventVehicles(eventId) });
    } catch (error) {
      setToast(error?.message || 'Araç silinemedi.');
    } finally {
      setVehicleBusy(false);
    }
  }

  async function retryQueries() {
    await Promise.all([eventQuery.refetch(), participantsQuery.refetch(), vehiclesQuery.refetch()]);
  }

  if (loading) {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={onBack} aria-label="Etkinliğe dön"><Icon.ChevronL width="22" height="22" /></button>
          <div className="evx-header-mid"><span className="evx-header-title">Ulaşım</span></div>
        </header>
        <div className="evx-body"><div className="evx-transport-loading" aria-label="Ulaşım planı yükleniyor" /></div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={onBack} aria-label="Etkinliğe dön"><Icon.ChevronL width="22" height="22" /></button>
          <div className="evx-header-mid"><span className="evx-header-title">Ulaşım</span></div>
        </header>
        <div className="evx-body">
          <div className="evx-empty" role="alert">
            <Icon.Truck width="28" height="28" />
            <span className="evx-empty-title">Ulaşım planı alınamadı</span>
            <span className="evx-empty-sub">Bağlantınızı kontrol edip yeniden deneyin.</span>
            <button type="button" className="evx-btn-secondary" onClick={retryQueries}>Yeniden dene</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} aria-label="Etkinliğe dön"><Icon.ChevronL width="22" height="22" /></button>
        <div className="evx-header-mid">
          <span className="evx-header-title">Ulaşım</span>
          <span className="evx-header-sub">{event?.name || 'Etkinlik planı'}</span>
        </div>
        <button type="button" className="evx-header-btn is-outline" onClick={sharePlan} aria-label="Ulaşım planını paylaş">
          <Icon.Upload width="18" height="18" />
        </button>
      </header>

      <div className="evx-body evx-transport-body">
        {waiting.length > 0 && (
          <section className="evx-transport-section" aria-labelledby="transport-waiting-title">
            <div className="evx-transport-section-head">
              <div>
                <h2 id="transport-waiting-title">Araç bekleyenler</h2>
                <p>Kişiyi seçip uygun araca yerleştirin.</p>
              </div>
              <span className="evx-pill tone-amber">{waiting.length} kişi</span>
            </div>
            <div className="evx-transport-people">
              {waiting.map((participant) => (
                <button
                  key={participant.id}
                  type="button"
                  className="evx-transport-person"
                  onClick={() => openVehiclePicker(participant.id)}
                >
                  <span className="evx-transport-avatar tone-amber">{initialsOf(nameOf(participant))}</span>
                  <span className="evx-transport-person-copy">
                    <strong>{nameOf(participant)}</strong>
                    <span>{participant.guest_of_name ? `${participant.guest_of_name} misafiri` : 'Henüz araca atanmadı'}</span>
                  </span>
                  <span className="evx-transport-person-action">Araç seç</span>
                  <Icon.ChevronR width="17" height="17" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="evx-transport-section" aria-labelledby="transport-vehicles-title">
          <div className="evx-transport-section-head">
            <div>
              <h2 id="transport-vehicles-title">Araçlar</h2>
              <p>Şoför, buluşma ve araçtakiler.</p>
            </div>
            <span className="evx-pill tone-neutral">{vehicles.length} araç</span>
          </div>

          {vehicles.length === 0 ? (
            <div className="evx-transport-no-vehicle">
              <span className="evx-transport-no-vehicle-icon"><Icon.Truck width="24" height="24" /></span>
              <span>
                <strong>Henüz araç eklenmedi</strong>
                <small>{waiting.length > 0 ? `${waiting.length} kişi araç bekliyor.` : 'İlk aracı ekleyerek planı başlatın.'}</small>
              </span>
              <button type="button" className="evx-btn-secondary" onClick={onOpenAddVehicle}>Araç ekle</button>
            </div>
          ) : (
            <div className="evx-transport-vehicle-list">
              {vehicles.map((vehicle) => {
                const riders = participants.filter((participant) => String(participant.vehicle_id) === String(vehicle.id));
                const { total, taken, available } = seatsOf(vehicle);
                const meeting = meetingOf(vehicle);
                const driverName = driverOf(vehicle, participants);
                const vehicleTitleId = `event-vehicle-${vehicle.id}-title`;
                return (
                  <article className="evx-transport-vehicle" key={vehicle.id} aria-labelledby={vehicleTitleId}>
                    <header className="evx-transport-vehicle-head">
                      <span className="evx-vehicle-icon"><Icon.Truck width="18" height="18" /></span>
                      <span className="evx-transport-vehicle-copy">
                        <strong id={vehicleTitleId}>{driverName}</strong>
                        <span>{total} yolcu koltuğu</span>
                      </span>
                      <span className={`evx-transport-seat-badge${available === 0 ? ' is-full' : ''}`}>
                        {available === 0 ? 'Dolu' : `${available} boş`}
                      </span>
                    </header>

                    <div className="evx-footer-row" style={{ padding: '8px 0 0' }}>
                      <button type="button" className="evx-btn-secondary" disabled={vehicleBusy}
                        onClick={() => startVehicleEdit(vehicle)}>Düzenle</button>
                      <button type="button" className="evx-btn-secondary evx-btn-danger"
                        disabled={vehicleBusy || taken > 0} title={taken > 0 ? 'Önce yolcuları araçtan çıkarın' : undefined}
                        onClick={() => removeVehicle(vehicle)}>Sil</button>
                    </div>

                    {editingVehicleId === vehicle.id && vehicleDraft && (
                      <div className="evx-info-expand" style={{ marginTop: 8 }}>
                        {!vehicle.driver_student_id && (
                          <label className="evx-field"><span className="evx-field-label">ŞOFÖR</span>
                            <input value={vehicleDraft.driverName} onChange={(e) => setVehicleDraft((d) => ({ ...d, driverName: e.target.value }))} /></label>
                        )}
                        <div className="evx-field-grid">
                          <label className="evx-field"><span className="evx-field-label">TELEFON</span>
                            <input value={vehicleDraft.driverPhone} onChange={(e) => setVehicleDraft((d) => ({ ...d, driverPhone: e.target.value }))} /></label>
                          <label className="evx-field"><span className="evx-field-label">YOLCU KOLTUĞU</span>
                            <input inputMode="numeric" value={vehicleDraft.passengerSeats}
                              onChange={(e) => setVehicleDraft((d) => ({ ...d, passengerSeats: e.target.value.replace(/[^0-9]/g, '') }))} /></label>
                        </div>
                        <label className="evx-field"><span className="evx-field-label">BULUŞMA YERİ</span>
                          <input value={vehicleDraft.meetingPlace} onChange={(e) => setVehicleDraft((d) => ({ ...d, meetingPlace: e.target.value }))} /></label>
                        <label className="evx-field"><span className="evx-field-label">NOT</span>
                          <input value={vehicleDraft.note} onChange={(e) => setVehicleDraft((d) => ({ ...d, note: e.target.value }))} /></label>
                        {vehicleError && <p className="evx-transport-error" role="alert">{vehicleError}</p>}
                        <div className="evx-footer-row" style={{ padding: 0 }}>
                          <button type="button" className="evx-btn-secondary" disabled={vehicleBusy}
                            onClick={() => { setEditingVehicleId(null); setVehicleDraft(null); setVehicleError(''); }}>Vazgeç</button>
                          <button type="button" className="evx-btn-primary" disabled={vehicleBusy} onClick={() => saveVehicle(vehicle)}>
                            {vehicleBusy ? 'Kaydediliyor…' : 'Kaydet'}
                          </button>
                        </div>
                      </div>
                    )}

                    {meeting && (
                      <div className="evx-transport-meeting">
                        <span className="evx-transport-meeting-label">Buluşma</span>
                        <strong>{meeting}</strong>
                      </div>
                    )}

                    <SeatDots driverName={driverName} total={total} taken={taken} available={available} />

                    <div className="evx-transport-riders">
                      <span className="evx-transport-riders-label">Araçtakiler</span>
                      <div className="evx-transport-rider-list">
                        <div className="evx-transport-driver">
                          <span className="evx-transport-avatar is-driver">{initialsOf(driverName)}</span>
                          <span>{driverName}</span>
                          <span className="evx-transport-driver-badge">Şoför</span>
                        </div>
                        {riders.map((rider) => (
                          <button
                            key={rider.id}
                            type="button"
                            className="evx-transport-rider"
                            onClick={() => openVehiclePicker(rider.id)}
                            aria-label={`${nameOf(rider)} için aracı değiştir`}
                          >
                            <span className="evx-transport-avatar">{initialsOf(nameOf(rider))}</span>
                            <span>{nameOf(rider)}</span>
                            <span className="evx-transport-rider-action">Değiştir</span>
                          </button>
                        ))}
                        {riders.length > 0 && available > 0 && (
                          <button
                            type="button"
                            className="evx-transport-add-rider"
                            onClick={() => openPassengerPicker(vehicle.id)}
                          >
                            <Icon.Plus width="16" height="16" /> Yolcu ekle <span>· {available} boş koltuk</span>
                          </button>
                        )}
                      </div>
                      {riders.length === 0 && available > 0 && (
                        <button
                          type="button"
                          className="evx-add-passenger-cta is-empty"
                          onClick={() => openPassengerPicker(vehicle.id)}
                        >
                          <span className="evx-add-passenger-cta-icon"><Icon.Plus width="18" height="18" /></span>
                          <span>
                            <strong>Yolcu ekle</strong>
                            <small>Öğrencilerden seçin veya listede olmayan birini ekleyin.</small>
                          </span>
                          <Icon.ChevronR width="17" height="17" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selfArranged.length > 0 && (
          <section className="evx-transport-section" aria-labelledby="transport-self-title">
            <div className="evx-transport-section-head is-compact">
              <div>
                <h2 id="transport-self-title">Kendi gelenler</h2>
                <p>Araç dağılımına dahil değiller.</p>
              </div>
              <span className="evx-pill tone-neutral">{selfArranged.length} kişi</span>
            </div>
            <div className="evx-transport-name-cloud">
              {selfArranged.map((participant) => (
                <button key={participant.id} type="button" onClick={() => openVehiclePicker(participant.id)}
                  aria-label={`${nameOf(participant)} ulaşım durumunu değiştir`}>{nameOf(participant)}</button>
              ))}
            </div>
          </section>
        )}

        {unspecified.length > 0 && (
          <section className="evx-transport-section evx-transport-unresolved" aria-labelledby="transport-unspecified-title">
            <div className="evx-transport-section-head is-compact">
              <strong id="transport-unspecified-title">Ulaşımı seçilmemiş</strong>
              <span className="evx-pill tone-neutral">{unspecified.length} kişi</span>
            </div>
            <div className="evx-transport-name-cloud">
              {unspecified.map((participant) => (
                <button key={participant.id} type="button" onClick={() => openVehiclePicker(participant.id)}
                  aria-label={`${nameOf(participant)} ulaşım durumunu belirle`}>{nameOf(participant)}</button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="evx-footer evx-transport-footer">
        <button type="button" className="evx-btn-primary" onClick={onOpenAddVehicle}>
          <Icon.Plus width="17" height="17" /> Yeni araç ekle
        </button>
      </div>

      <VehiclePicker
        participant={selectedParticipant}
        participants={participants}
        vehicles={vehicles}
        assigning={assigning}
        error={assignmentError}
        onAssign={assignToVehicle}
        onSetMode={setTransportMode}
        onClose={closeVehiclePicker}
        onAddVehicle={onOpenAddVehicle}
      />
      <MobileEventPassengerPicker
        open={!!passengerVehicle}
        eventId={eventId}
        participants={participants}
        value={[]}
        max={passengerVehicle ? seatsOf(passengerVehicle).available : 0}
        excludedStudentIds={passengerVehicle?.driver_student_id ? [passengerVehicle.driver_student_id] : []}
        submitting={passengerSubmitting}
        title={passengerVehicle ? `${driverOf(passengerVehicle, participants)} aracına yolcu ekle` : 'Araca yolcu ekle'}
        onClose={closePassengerPicker}
        onConfirm={addPassengersToVehicle}
      />
      <MobileToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
