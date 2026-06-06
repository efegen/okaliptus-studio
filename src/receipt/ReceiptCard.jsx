import React from 'react';
import './receipt.css';
import branchLogo from './assets/branch.png';

// Teşekkür Makbuzu kartı — 1080×1350 sabit, normalize model alır (bkz.
// buildReceiptModel.js). Yalnız sunum: ekran dışında mount edilip
// modern-screenshot ile PNG'ye rasterize edilir (bkz. renderReceiptToPng.js).
// Şablon: design_handoff_makbuz/Okaliptus Yoga - Makbuz.html.
export function ReceiptCard({ model, innerRef }) {
  const items = Array.isArray(model?.items) ? model.items : [];
  return (
    <div className="rcpt-root" ref={innerRef}>
      <div className="rcpt-frame-outer" aria-hidden="true" />
      <div className="rcpt-frame-inner" aria-hidden="true" />

      <header className="rcpt-head">
        <img className="rcpt-branch" src={branchLogo} alt="" />
        <div className="rcpt-wordmark">Okaliptus</div>
        <div className="rcpt-subtitle">YOGA STUDIO</div>
        <div className="rcpt-doctag">Teşekkür Makbuzu</div>
      </header>

      <section className="rcpt-meta">
        <div className="rcpt-cell">
          <span className="rcpt-cap">Makbuz No</span>
          <span className="rcpt-val">{model?.receiptNo}</span>
        </div>
        <div className="rcpt-cell">
          <span className="rcpt-cap">Alıcı</span>
          <span className="rcpt-val rcpt-name">{model?.customerName}</span>
        </div>
        <div className="rcpt-cell">
          <span className="rcpt-cap">Tarih</span>
          <span className="rcpt-val">{model?.dateText}</span>
          {model?.timeText ? <span className="rcpt-time">{model.timeText}</span> : null}
        </div>
      </section>

      <section className="rcpt-items">
        <div className="rcpt-items-head">
          <span className="rcpt-hp">Ürün</span>
          <span className="rcpt-hq">Adet</span>
          <span className="rcpt-ht">Tutar</span>
        </div>
        {items.map((it, i) => (
          <div className="rcpt-item" key={i}>
            {it.thumbSrc
              ? <img className="rcpt-thumb" src={it.thumbSrc} alt="" />
              : <div className="rcpt-thumb-ph" aria-hidden="true" />}
            <div className="rcpt-info">
              <div className="rcpt-pname">{it.name}</div>
              {it.desc ? <div className="rcpt-pdesc">{it.desc}</div> : null}
            </div>
            <div className="rcpt-pqty">{it.qty}</div>
            <div className="rcpt-pprice">{it.lineText}</div>
          </div>
        ))}
      </section>

      <section className="rcpt-summary">
        <div className="rcpt-totals">
          <div className="rcpt-trow">
            <span className="rcpt-lbl">Ara Toplam</span>
            <span className="rcpt-amt">{model?.subtotalText}</span>
          </div>
          <div className="rcpt-grand">
            <span className="rcpt-glbl">Toplam</span>
            <span className="rcpt-gamt">{model?.totalText}</span>
          </div>
        </div>
      </section>

      <div className="rcpt-thanks">
        <div className="rcpt-thanks-big">Geldiğiniz için teşekkürler.</div>
        <div className="rcpt-thanks-sub">Nefesinizle kalın — iyi dersler dileriz.</div>
      </div>

      <footer className="rcpt-footer">
        <span className="rcpt-footer-brand">Okaliptus Yoga</span>
        <span>{model?.footerContact}</span>
      </footer>
    </div>
  );
}
