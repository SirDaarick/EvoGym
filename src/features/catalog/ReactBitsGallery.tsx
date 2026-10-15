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
  { title: 'Estudio de muestra', description: 'Espacio de referencia para explorar la distribución.', label: 'Vista previa' },
  { title: 'Clase de muestra', description: 'Clase de referencia sin opción de reserva.', label: 'Vista previa' },
  { title: 'Informe de muestra', description: 'Datos ilustrativos; no es un informe real.', label: 'Vista previa' },
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

  return <section className="react-bits-gallery" aria-label="Vistas previas de React Bits">
    <h2>Vistas previas interactivas de React Bits</h2>
    <p className="muted">Estos ejemplos locales usan contenido ilustrativo y no modifican registros de la aplicación.</p>
    <div className="react-bits-grid">
      <article className="react-bits-demo"><h3>CodeSlots</h3><p className="muted">NO ES AUTENTICACIÓN. Ingresa cuatro dígitos de muestra.</p>
        <CodeSlots length={4} value={code} onChange={setCode} ariaLabel="Dígitos de muestra; no es autenticación" autoComplete="off" accentColor="var(--color-primary)" slotColor="var(--color-soft)" inkColor="var(--color-ink)" digitColor="var(--color-ink)" />
        <p role="status">Dígitos de muestra ingresados: {code.length} de 4</p>
        <CodeSlots length={4} disabled ariaLabel="Dígitos de muestra deshabilitados" autoComplete="off" />
      </article>
      <article className="react-bits-demo"><h3>JellyRadio</h3><p className="muted">Selecciona una opción de referencia.</p>
        <JellyRadio items={['Muestra A', 'Muestra B', 'Muestra C']} value={radio} onChange={setRadio} ariaLabel="Selección de referencia" chipColor="var(--color-soft)" activeColor="var(--color-primary)" textColor="var(--color-ink)" activeTextColor="var(--catalog-primary-label)" />
        <p role="status">Selección: {radio}</p>
      </article>
      <article className="react-bits-demo"><h3>RubberSegment</h3><p className="muted">Cambia la vista ilustrativa.</p>
        <RubberSegment items={['Resumen', 'Detalle']} value={segment} onChange={setSegment} thumbColor="var(--color-primary)" trackColor="var(--color-soft)" textColor="var(--color-ink)" activeTextColor="var(--catalog-primary-label)" draggable={!reducedMotion} />
        <p role="status">Vista: {segment}</p>
      </article>
      <article className="react-bits-demo"><h3>SpringCheck</h3><p className="muted">Estado local de una lista de verificación.</p>
        <SpringCheck label="Marcar elemento como completo" checked={checked} onChange={setChecked} color="var(--color-primary)" fillColor="var(--color-primary)" />
        <p role="status">Lista de verificación: {checked ? 'completa' : 'abierta'}</p>
      </article>
      <article className="react-bits-demo"><h3>SquishSwitch</h3><p className="muted">Activa una preferencia visual de muestra.</p>
        <SquishSwitch
          label="Preferencia visual"
          checked={switched}
          onChange={setSwitched}
          trackColor="var(--color-divider)"
          trackOnColor="var(--color-primary)"
          thumbColor="var(--color-muted)"
          thumbOnColor="var(--color-primary-text)"
        />
        <p role="status">Preferencia: {switched ? 'activada' : 'desactivada'}</p>
      </article>
      <article className="react-bits-demo"><h3>SwipeToast</h3><p className="muted">Avisos de vista previa. Los errores permanecen visibles hasta que se cierran manualmente.</p>
        <div className="flow"><button type="button" className="button button-secondary" onClick={() => setToast('success')}>Mostrar aviso de vista previa</button><button type="button" className="button button-secondary" onClick={() => setToast('error')}>Mostrar error de vista previa</button></div>
        {toast && <div role={toast === 'error' ? 'alert' : undefined}><SwipeToast key={toast} open title={toast === 'error' ? 'Error de vista previa' : 'Resultado de vista previa'} description="No se modificaron datos de la aplicación." inline duration={toast === 'error' ? 0 : 5000} fuse={toast === 'error' ? 'none' : 'bottom'} closeButton closeLabel="Cerrar aviso" reducedMotion={reducedMotion} background="var(--color-surface)" color="var(--color-ink)" fuseColor={toast === 'error' ? 'var(--catalog-field-error, #A32222)' : 'var(--color-primary)'} onClose={() => setToast(null)} /></div>}
      </article>
      <article className="react-bits-demo react-bits-wide"><h3>MagicBento</h3><p className="muted">Tarjetas decorativas con contenido ilustrativo.</p>
        <MagicBento cards={fictionalCards} disableAnimations={reducedMotion} enableStars={false} enableSpotlight={!reducedMotion} clickEffect={!reducedMotion} enableMagnetism={false} glowColor="252, 108, 6" />
      </article>
      <article className="react-bits-demo"><h3>AnimatedList</h3><p className="muted">Elige una entrada ilustrativa.</p>
        <AnimatedList items={fictionalItems} onItemSelect={item => setSelectedItem(typeof item === 'string' ? item : String(item.title))} animation={reducedMotion ? 'none' : 'slide'} showGradients={false} maxHeight={240} />
        <p role="status">Elemento seleccionado: {selectedItem}</p>
      </article>
      <article className="react-bits-demo"><h3>Stepper</h3><p className="muted">Secuencia de vista previa; no es un flujo operativo.</p>
        <Stepper step={step} onStepChange={setStep} onFinalStepCompleted={() => setStep(1)} transition={reducedMotion ? 'none' : 'fade'} nextButtonText="Siguiente paso" backButtonText="Paso anterior" completeButtonText="Reiniciar recorrido" width="100%">
          <Step title="Paso uno">Primer paso</Step><Step title="Paso dos">Segundo paso</Step><Step title="Paso tres">Último paso</Step>
        </Stepper>
        <p role="status">Paso actual: {step}</p>
      </article>
    </div>
  </section>;
}
