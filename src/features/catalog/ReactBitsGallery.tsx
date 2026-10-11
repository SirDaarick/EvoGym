import { useState } from 'react';
import CodeSlots from './react-bits/CodeSlots';
import JellyRadio from './react-bits/JellyRadio';
import RubberSegment from './react-bits/RubberSegment';
import SpringCheck from './react-bits/SpringCheck';
import SquishSwitch from './react-bits/SquishSwitch';
import SwipeToast from './react-bits/SwipeToast';
import MagicBento from './react-bits/MagicBento';
import AnimatedList from './react-bits/AnimatedList';
import Stepper, { Step } from './react-bits/Stepper';

const fictionalCards = [
  { title: 'Estudio de muestra', description: 'Espacio ficticio para explorar la distribución.', label: 'Demostración' },
  { title: 'Clase de muestra', description: 'Clase ficticia sin opción de reserva.', label: 'Demostración' },
  { title: 'Informe de muestra', description: 'Datos ilustrativos; no es un informe real.', label: 'Demostración' },
];

const fictionalItems = [
  { id: 'sample-a', title: 'Muestra A', description: 'Elemento ilustrativo' },
  { id: 'sample-b', title: 'Muestra B', description: 'No se modifican registros' },
  { id: 'sample-c', title: 'Muestra C', description: 'Interacción local del catálogo' },
];

export function ReactBitsGallery() {
  const [code, setCode] = useState('');
  const [radio, setRadio] = useState('Muestra A');
  const [segment, setSegment] = useState('Resumen');
  const [checked, setChecked] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [toast, setToast] = useState<'success' | 'error' | null>(null);
  const [selectedItem, setSelectedItem] = useState('Muestra A');
  const [step, setStep] = useState(1);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  return <section className="react-bits-gallery" aria-label="Demostraciones de React Bits">
    <h2>Demostraciones interactivas de React Bits</h2>
    <p className="muted">Estos ejemplos locales usan datos ficticios y no modifican registros de la aplicación.</p>
    <div className="react-bits-grid">
      <article className="react-bits-demo"><h3>CodeSlots</h3><p className="muted">NO ES AUTENTICACIÓN. Ingresa cuatro dígitos de muestra.</p>
        <CodeSlots length={4} value={code} onChange={setCode} ariaLabel="Dígitos de muestra; no es autenticación" autoComplete="off" accentColor="var(--color-primary)" slotColor="var(--color-soft)" inkColor="var(--color-ink)" digitColor="var(--color-ink)" />
        <p role="status">Dígitos de muestra ingresados: {code.length} de 4</p>
        <CodeSlots length={4} disabled ariaLabel="Dígitos de muestra deshabilitados" autoComplete="off" />
      </article>
      <article className="react-bits-demo"><h3>JellyRadio</h3><p className="muted">Selecciona una muestra ficticia.</p>
        <JellyRadio items={['Muestra A', 'Muestra B', 'Muestra C']} value={radio} onChange={setRadio} ariaLabel="Selección de muestra ficticia" chipColor="var(--color-soft)" activeColor="var(--color-primary)" textColor="var(--color-ink)" activeTextColor="var(--catalog-primary-label)" />
        <p role="status">Selección: {radio}</p>
      </article>
      <article className="react-bits-demo"><h3>RubberSegment</h3><p className="muted">Cambia la vista ilustrativa.</p>
        <RubberSegment items={['Resumen', 'Detalle']} value={segment} onChange={setSegment} thumbColor="var(--color-primary)" trackColor="var(--color-soft)" textColor="var(--color-ink)" activeTextColor="var(--catalog-primary-label)" draggable={!reducedMotion} />
        <p role="status">Vista: {segment}</p>
      </article>
      <article className="react-bits-demo"><h3>SpringCheck</h3><p className="muted">Estado local de una lista de verificación.</p>
        <SpringCheck label="Marcar muestra como completa" checked={checked} onChange={setChecked} color="var(--color-primary)" fillColor="var(--color-primary)" />
        <p role="status">Lista de verificación: {checked ? 'completa' : 'abierta'}</p>
      </article>
      <article className="react-bits-demo"><h3>SquishSwitch</h3><p className="muted">Activa una preferencia visual de muestra.</p>
        <SquishSwitch label="Preferencia de muestra" checked={switched} onChange={setSwitched} trackOnColor="var(--color-primary)" />
        <p role="status">Preferencia: {switched ? 'activada' : 'desactivada'}</p>
      </article>
      <article className="react-bits-demo"><h3>SwipeToast</h3><p className="muted">El resultado es ficticio. Los errores permanecen visibles hasta que se cierran manualmente.</p>
        <div className="flow"><button type="button" className="button button-secondary" onClick={() => setToast('success')}>Mostrar aviso de muestra</button><button type="button" className="button button-secondary" onClick={() => setToast('error')}>Mostrar error de muestra</button></div>
        {toast && <div role={toast === 'error' ? 'alert' : undefined}><SwipeToast key={toast} open title={toast === 'error' ? 'Error de muestra' : 'Resultado de muestra'} description="No se modificaron datos de la aplicación." inline duration={toast === 'error' ? 0 : 5000} fuse={toast === 'error' ? 'none' : 'bottom'} closeButton closeLabel="Cerrar aviso" reducedMotion={reducedMotion} onClose={() => setToast(null)} /></div>}
      </article>
      <article className="react-bits-demo react-bits-wide"><h3>MagicBento</h3><p className="muted">Tarjetas decorativas con contenido ficticio.</p>
        <MagicBento cards={fictionalCards} disableAnimations={reducedMotion} enableStars={false} enableSpotlight={!reducedMotion} clickEffect={!reducedMotion} enableMagnetism={false} glowColor="255, 154, 84" />
      </article>
      <article className="react-bits-demo"><h3>AnimatedList</h3><p className="muted">Elige una entrada ilustrativa.</p>
        <AnimatedList items={fictionalItems} onItemSelect={item => setSelectedItem(typeof item === 'string' ? item : String(item.title))} animation={reducedMotion ? 'none' : 'slide'} showGradients={false} maxHeight={240} />
        <p role="status">Elemento seleccionado: {selectedItem}</p>
      </article>
      <article className="react-bits-demo"><h3>Stepper</h3><p className="muted">Secuencia de muestra; no es un flujo operativo.</p>
        <Stepper step={step} onStepChange={setStep} onFinalStepCompleted={() => setStep(1)} transition={reducedMotion ? 'none' : 'fade'} nextButtonText="Siguiente paso de muestra" backButtonText="Paso anterior de muestra" completeButtonText="Reiniciar muestra" width="100%">
          <Step title="Ejemplo uno">Primer paso ficticio</Step><Step title="Ejemplo dos">Segundo paso ficticio</Step><Step title="Ejemplo tres">Último paso ficticio</Step>
        </Stepper>
        <p role="status">Paso actual de muestra: {step}</p>
      </article>
    </div>
  </section>;
}
