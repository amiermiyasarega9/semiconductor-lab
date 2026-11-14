import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadIndexLab() {
  const html = fs.readFileSync('index.html', 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.html should contain an inline <script> block');

  const elements = new Map<string, any>();
  const makeEl = (id = '', dataset: Record<string, string> = {}) => {
    const cls = new Set<string>();
    const el: any = {
      id,
      dataset: { ...dataset },
      style: {},
      value: '0',
      checked: false,
      textContent: '',
      innerHTML: '',
      width: 600,
      height: 400,
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force === undefined) {
            if (cls.has(name)) cls.delete(name);
            else cls.add(name);
          } else if (force) cls.add(name);
          else cls.delete(name);
        },
        add: (name: string) => cls.add(name),
        remove: (name: string) => cls.delete(name),
        contains: (name: string) => cls.has(name),
      },
      addEventListener: () => {},
      setAttribute: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 400 }),
      getContext: () => ({
        setTransform: () => {},
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        arcTo: () => {},
        ellipse: () => {},
        bezierCurveTo: () => {},
        fill: () => {},
        stroke: () => {},
        fillText: () => {},
        save: () => {},
        restore: () => {},
        setLineDash: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
      }),
    };
    return el;
  };

  const docEl = { dataset: {} as Record<string, string> };
  const fakeDoc = {
    documentElement: docEl,
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('#pnModes')) {
        return ['joining', 'unbiased', 'forward', 'reverse'].map(m => makeEl('', { mode: m }));
      }
      if (sel.includes('#bandMaterials')) {
        return ['conductor', 'semiconductor', 'insulator', 'ntype'].map(m => makeEl('', { mat: m }));
      }
      if (sel.includes('#bandSubRow')) {
        return ['Ge', 'Si', 'GaAs'].map(s => makeEl('', { sub: s }));
      }
      if (sel.includes('#diodeTabs')) {
        return ['1', '2', '3', '4'].map(t => makeEl('', { tab: t }));
      }
      if (sel.includes('#diodeViews')) {
        return ['compare', 'ideal', 'actual'].map(v => makeEl('', { view: v }));
      }
      if (sel.includes('#dMaterials')) {
        return ['Si', 'Ge', 'GaAs'].map(m => makeEl('', { mat: m }));
      }
      if (sel.includes('#dPresets')) {
        return ['-21.5', '-10', '0.5', '5'].map(vs => makeEl('', { vs }));
      }
      if (sel.includes('#resModes')) {
        return ['dc', 'ac', 'avg'].map(m => makeEl('', { rmode: m }));
      }
      if (sel.includes('nav.site-nav')) {
        return ['junction', 'bands', 'diode', 'resistance'].map(r => makeEl('', { route: r }));
      }
      return [];
    },
  };

  const sandbox: any = {
    document: fakeDoc,
    window: {
      devicePixelRatio: 1,
      addEventListener: () => {},
    },
    location: { hash: '#junction' },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    setTimeout,
    clearTimeout,
    Math,
    Number,
    Object,
    Array,
    String,
  };
  sandbox.window.document = fakeDoc;

  vm.runInNewContext(match[1], sandbox);
  return sandbox.window.__SEMILAB__;
}

test('PN junction physics matches Shockley & barrier equations', () => {
  const lab = loadIndexLab();
  // Unbiased 300 K
  const eq = lab.computePNPhysics({
    vd: 0, n: 1, isNA: 10, tempK: 300, forming: false, progress: 0
  });
  assert.ok(Math.abs(eq.vt * 1000 - 25.852) < 0.02, `Expected ~25.85 mV, got ${eq.vt * 1000}`);
  assert.equal(eq.iNet, 0);
  assert.ok(Math.abs(eq.bar - 0.70) < 1e-6);
  assert.ok(Math.abs(eq.wr - 1.0) < 1e-6);

  // Forward +0.65 V
  const fwd = lab.computePNPhysics({
    vd: 0.65, n: 1, isNA: 10, tempK: 300, forming: false, progress: 0
  });
  assert.ok(fwd.iNet > 0.5, 'Forward current at 0.65 V should be substantial (A range)');
  assert.ok(Math.abs(fwd.bar - 0.05) < 1e-6);
  assert.ok(Math.abs(fwd.wr - Math.sqrt(0.05 / 0.70)) < 1e-6);

  // Reverse -3.0 V
  const rev = lab.computePNPhysics({
    vd: -3.0, n: 1, isNA: 10, tempK: 300, forming: false, progress: 0
  });
  assert.ok(rev.iNet < 0 && Math.abs(rev.iNet + 10e-9) < 1e-12);
  assert.ok(Math.abs(rev.bar - 3.70) < 1e-6);
  assert.ok(Math.abs(rev.wr - (1 + 1.15 * (3 / 5))) < 1e-6);

  // Joining overrides applied voltage to 0
  const join = lab.computePNPhysics({
    vd: 0.65, n: 1, isNA: 10, tempK: 300, forming: true, progress: 0.5
  });
  assert.equal(join.vEff, 0);
  assert.equal(join.iNet, 0);
  assert.ok(Math.abs(join.bar - 0.35) < 1e-6);
  assert.ok(Math.abs(join.wr - 0.5) < 1e-6);
});

test('Diode lab model handles thermal voltage, forward, reverse, and Zener breakdown without NaN', () => {
  const lab = loadIndexLab();
  const si = lab.DIODE_MATERIALS.Si;

  const th = lab.diodeThermal(27);
  assert.equal(th.tk, 300);
  assert.ok(Math.abs(th.vt * 1000 - 25.875) < 0.01);

  // Forward +5 V Si
  const fwd = lab.solveDiodeCircuit(5, si, 27, 20);
  assert.equal(fwd.ideal.vd, 0);
  assert.ok(Math.abs(fwd.ideal.id - 10) < 1e-6);
  assert.ok(fwd.actual.vd > 0.65 && fwd.actual.vd < 0.75);
  assert.ok(fwd.actual.id > 8.4 && fwd.actual.id < 8.8);

  // Sub-knee +0.5 V Si
  const sub = lab.solveDiodeCircuit(0.5, si, 27, 20);
  assert.ok(sub.actual.id < 0.1);

  // Reverse -10 V Si
  const rev = lab.solveDiodeCircuit(-10, si, 27, 20);
  assert.equal(rev.actual.vd, -10);
  assert.ok(rev.actual.id < 0 && Math.abs(rev.actual.id) < 1e-4);

  // Reverse near breakdown edge (ensure no NaN from negative pow base)
  const edge = lab.diodeActualCurrent(-19.75, si, 27, 20);
  assert.ok(Number.isFinite(edge), 'Near-breakdown current must not be NaN');

  // Breakdown -21.5 V with V_BV = 20 V
  const brk = lab.solveDiodeCircuit(-21.5, si, 27, 20);
  assert.ok(brk.actual.vd < -19.9 && brk.actual.vd > -20.3);
  assert.ok(brk.actual.id < -2.0 && Number.isFinite(brk.actual.id));
});

test('Diode resistance levels compute R_D, r_d, r_av, and sinusoidal tracer accurately', () => {
  const lab = loadIndexLab();
  const st = lab.computeResistanceState({
    vdQ: 0.65,
    dVpkMv: 15,
    tempK: 300,
    theta: Math.PI / 2,
  });

  // DC static R_D = V_D / I_D
  assert.ok(Math.abs(st.rDC - st.vdQ / (st.idQ / 1000)) < 1e-6);
  // AC dynamic r_d ~ nV_T / I_D
  assert.ok(Math.abs(st.rDyn - (st.vt * 1000) / st.idQ) < 1e-3);
  assert.ok(st.rDyn < st.rDC, 'Dynamic r_d must be much smaller than static R_D on exponential knee');

  // Average AC r_av = dV_pp / dI_pp
  assert.ok(st.rAvg !== null && Math.abs(st.rAvg - st.dVpp / (st.dIpp / 1000)) < 1e-6);

  // Instantaneous tracer at theta = pi/2 hits positive peak V_DQ + dV_pk
  assert.ok(Math.abs(st.vdInst - 0.665) < 1e-6);
  assert.ok(Math.abs(st.idInst - st.iMax) < 1e-6);

  // Zero swing gives rAvg = null and tracer at Q-point
  const dcOnly = lab.computeResistanceState({
    vdQ: 0.64,
    dVpkMv: 0,
    tempK: 300,
    theta: 1.2,
  });
  assert.equal(dcOnly.rAvg, null);
  assert.equal(dcOnly.vdInst, 0.64);
});
