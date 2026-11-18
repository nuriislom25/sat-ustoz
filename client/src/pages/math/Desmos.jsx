import { useState } from 'react';
import { Modal } from '../../components/ui.jsx';
import MathText from './MathText.jsx';

/**
 * The Desmos graphing calculator (the same one students get in Bluebook on test day), embedded from desmos.com.
 * Stays mounted while hidden, so expressions are kept between questions.
 */
export function Desmos({ className = '' }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`desmos ${className}`}>
      {!loaded && <div className="desmos-wait">Loading the Desmos calculator…</div>}
      <iframe title="Desmos graphing calculator" src="https://www.desmos.com/calculator?lang=en" onLoad={() => setLoaded(true)}
        allow="clipboard-write" referrerPolicy="strict-origin-when-cross-origin" />
    </div>
  );
}

const SHEET = [
  ['Circle', '$A = \\pi r^2$', '$C = 2\\pi r$'],
  ['Rectangle', '$A = \\ell w$', ''],
  ['Triangle', '$A = \\frac{1}{2}bh$', ''],
  ['Right triangle', '$c^2 = a^2 + b^2$', ''],
  ['Special right triangles', '$x,\\ x\\sqrt{3},\\ 2x$ (30°-60°-90°)', '$s,\\ s,\\ s\\sqrt{2}$ (45°-45°-90°)'],
  ['Rectangular box', '$V = \\ell wh$', ''],
  ['Cylinder', '$V = \\pi r^2 h$', ''],
  ['Sphere', '$V = \\frac{4}{3}\\pi r^3$', ''],
  ['Cone', '$V = \\frac{1}{3}\\pi r^2 h$', ''],
  ['Pyramid', '$V = \\frac{1}{3}\\ell wh$', ''],
];
/** The SAT reference sheet. */
export function ReferenceSheet({ onClose }) {
  return (
    <Modal title="Reference sheet" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="mref">
        {SHEET.map(([n, a, b]) => <div key={n} className="mref-row"><b>{n}</b><MathText>{a}</MathText>{b && <MathText>{b}</MathText>}</div>)}
      </div>
      <ul className="mref-notes">
        <li>The number of degrees of arc in a circle is 360.</li>
        <li><MathText>{'The number of radians of arc in a circle is $2\\pi$.'}</MathText></li>
        <li>The sum of the measures in degrees of the angles of a triangle is 180.</li>
      </ul>
    </Modal>
  );
}
