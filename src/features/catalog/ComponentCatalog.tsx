import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Panel } from '../../shared/ui';
import { ThemeControl } from './feedback';

const catalogTabs = ['Componentes', 'Vistas de datos', 'Flujos de trabajo'] as const;
type CatalogTab = typeof catalogTabs[number];

function ComponentFiches() {
  return <div className="bento-grid">
    <Panel><h2>Acciones y estados</h2><div className="flow"><Button>Acción principal</Button><Button variant="secondary">Acción secundaria</Button><Button disabled>Acción pendiente</Button></div>
      <p className="muted">La acción pendiente necesita una regla de negocio acordada.</p><div className="flow"><Badge>Sin evaluar</Badge><Badge tone="success">Confirmado</Badge><Badge tone="warning">Pendiente</Badge><Badge tone="error">Error</Badge></div>
      <dl className="component-fiche"><dt>Botón</dt><dd>Primario para la tarea central; secundario para salida o alternativa; disabled con explicación visible.</dd><dt>Estado</dt><dd>Tono y texto se combinan: el color no es la única señal.</dd></dl></Panel>
    <Panel><h2>Campos con contexto</h2><Field id="catalog-name" label="Nombre" placeholder="Nombre de demostración" /><Field id="catalog-error" label="Referencia" error="Escribe una referencia de muestra para continuar." />
      <p className="muted">Las etiquetas permanecen visibles; el error se asocia al campo y no borra lo capturado.</p><dl className="component-fiche"><dt>Campo</dt><dd>Etiqueta, valor, error anunciado y foco visible; evita depender del placeholder.</dd></dl></Panel>
    <Panel><h2>Información y resultado</h2><Notice>Estado desconocido: verifica el resultado antes de repetir una operación.</Notice><Notice tone="warning">La libreta física sigue siendo obligatoria.</Notice><Notice tone="error">Ejemplo de error: los datos capturados se conservan.</Notice><Notice tone="success">Ejemplo de resultado confirmado.</Notice>
      <dl className="component-fiche"><dt>Feedback</dt><dd>Éxito, advertencia, error y desconocido se expresan en texto; una transición no implica una operación.</dd></dl></Panel>
    <Panel><EmptyState title="Sin registros">No hay movimientos para el periodo de muestra. Un estado vacío no equivale a un error.</EmptyState><p className="muted" aria-busy="true">Ejemplo de carga: consultando datos de demostración…</p><Badge tone="warning">Ejemplo de datos desactualizados</Badge>
      <dl className="component-fiche"><dt>Estados</dt><dd>Vacío, carga y desactualizado se distinguen de datos en cero y de un fallo.</dd></dl></Panel>
    <Panel className="span-full"><h2>Pasos y jerarquía</h2><div className="catalog-steps" aria-label="Pasos de un flujo ficticio"><span aria-current="step">1 · Captura</span><span>2 · Revisión</span><span>3 · Resultado</span></div><p className="muted">Indicador solo informativo; cada paso real debe controlar avance y retorno de foco.</p></Panel>
  </div>;
}

export function ComponentCatalog() {
  const [activeTab, setActiveTab] = useState<CatalogTab>(catalogTabs[0]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? catalogTabs.length - 1 : (index + direction + catalogTabs.length) % catalogTabs.length;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    setActiveTab(catalogTabs[destination]);
    tabRefs.current[destination]?.focus();
  }

  const activeIndex = catalogTabs.indexOf(activeTab);
  return <div className="catalog-page">
    <PageHeader eyebrow="DESARROLLO · SISTEMA COMPARTIDO" title="Componentes compartidos" description="Referencia interactiva de componentes, estados y patrones asociados a los 18 flujos. Los datos son ficticios; no representa operaciones reales." action={<ThemeControl />} />
    <div className="catalog-toolbar"><span className="muted">EvoGym · referencia local de interfaz</span></div>
    <div className="catalog-tabs" role="tablist" aria-label="Secciones del catálogo">
      {catalogTabs.map((tab, index) => <button key={tab} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" id={`catalog-tab-${index}`} aria-controls="catalog-panel" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} className="catalog-tab" onClick={() => setActiveTab(tab)} onKeyDown={event => moveTab(event, index)}>{tab}</button>)}
    </div>
    <section id="catalog-panel" className="catalog-content" role="tabpanel" aria-labelledby={`catalog-tab-${activeIndex}`} tabIndex={0}>
      {activeTab === 'Componentes' && <ComponentFiches />}
      {activeTab === 'Vistas de datos' && <><h2>Vistas de datos</h2><p className="muted">Los gráficos respetan tokens de tema y reducen movimiento según las preferencias del sistema.</p></>}
      {activeTab === 'Flujos de trabajo' && <><h2>Flujos de trabajo</h2><p className="muted">Galería de pantallas de demostración.</p></>}
    </section>
  </div>;
}
