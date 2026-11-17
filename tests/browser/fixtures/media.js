// Testtöne als WAV-Blob: 8 kHz, 8 Bit, mono. Kein Netz, keine Mediendatei im Repo.
function wav(sekunden, amplitude) {
  const rate = 8000;
  const n = Math.round(sekunden * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const text = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    v.setUint8(
      44 + i,
      128 + Math.round(amplitude * 127 * Math.sin((2 * Math.PI * 440 * i) / rate)),
    );
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// id → [Sekunden, Amplitude, Attribute]
const faelle = {
  laut: [6, 0.8, ""], // läuft, hörbar, länger als 3 s, ohne Bedienung: Befund
  bedienbar: [6, 0.8, "controls"],
  stumm: [6, 0.8, "muted"],
  kurz: [2, 0.8, ""],
  still: [6, 0, ""], // Tonspur ohne Pegel: nicht belegt
};

const ziel = document.getElementById("medien");
for (const [id, [sekunden, amplitude, attribute]] of Object.entries(faelle)) {
  const el = document.createElement("audio");
  el.id = id;
  el.setAttribute("autoplay", "");
  for (const a of attribute.split(" ").filter(Boolean)) el.setAttribute(a, "");
  // Das Attribut allein stellt bei einem per Skript erzeugten Element `muted` nicht ein.
  if (attribute.includes("muted")) el.muted = true;
  el.src = wav(sekunden, amplitude);
  ziel.append(el);
}
