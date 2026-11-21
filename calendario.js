import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CATEGORIAS_OFICIALES = ['U9', 'U11', 'U13', 'U15', 'U19', 'U21', 'Libre'];
const TABLA_TORNEOS = 'torneos_match_control';

let estado = estadoInicial();
let supabaseClub = null;
let empresaIdActual = '';
let nombreOrgActual = 'Organización de Voleibol';
let temporizadorSync = null;

function normalizarCategoria(rawCat) {
    const limpia = (rawCat || '').trim();
    if (!limpia) return 'Libre';

    const sinGuion = limpia.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const oficialMatch = CATEGORIAS_OFICIALES.find(
        (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '') === sinGuion
    );

    return oficialMatch || limpia;
}

function crearEstructuraCategoria(nombreCat) {
    const cat = normalizarCategoria(nombreCat);
    return {
        nombre: cat,
        diasJuego: '',
        condiciones: '',
        cantidadGrupos: 2,
        grupos: [],
        eliminatoria: {
            rondaActual: null,
            partidos: [],
            campeon: null
        }
    };
}

function estadoInicial() {
    const categoriasData = {};
    CATEGORIAS_OFICIALES.forEach((cat) => {
        categoriasData[cat] = crearEstructuraCategoria(cat);
    });

    return {
        nombreTorneo: 'Torneo Oficial de Voleibol',
        categoriaActiva: 'U9',
        canchas: ['Cancha 1', 'Cancha 2'],
        equipos: [],
        categoriasData
    };
}

function asegurarCategoria(nombreCat) {
    const cat = normalizarCategoria(nombreCat);
    if (!estado.categoriasData || typeof estado.categoriasData !== 'object') {
        estado.categoriasData = {};
    }
    if (!estado.categoriasData[cat]) {
        estado.categoriasData[cat] = crearEstructuraCategoria(cat);
    }
    return cat;
}

function obtenerDatosCategoriaActiva() {
    const cat = asegurarCategoria(estado.categoriaActiva);
    estado.categoriaActiva = cat;
    return estado.categoriasData[cat];
}

function actualizarEstadoSync(texto, colorClass = 'text-slate-300') {
    const el = document.getElementById('syncStatusTexto');
    if (el) {
        el.className = `text-[11px] font-bold ${colorClass}`;
        el.textContent = texto;
    }
}

function inicializarSupabaseClub() {
    empresaIdActual = localStorage.getItem('youcontrol_empresa_id') || '';
    nombreOrgActual =
        localStorage.getItem('control_voley_club_nombre') ||
        empresaIdActual ||
        'Organización de Voleibol';

    const supaUrl = localStorage.getItem('control_voley_supa_url') || '';
    const supaKey = localStorage.getItem('control_voley_supa_key') || '';

    if (supaUrl && supaKey && empresaIdActual) {
        supabaseClub = createClient(supaUrl, supaKey);
        return true;
    }

    supabaseClub = null;
    return false;
}

function hidratarEstadoDesdeObjeto(nube) {
    const base = estadoInicial();
    const categoriasData = { ...base.categoriasData };

    if (nube && nube.categoriasData && typeof nube.categoriasData === 'object') {
        Object.entries(nube.categoriasData).forEach(([clave, valor]) => {
            const catNormalizada = normalizarCategoria(clave);
            const existente = categoriasData[catNormalizada] || crearEstructuraCategoria(catNormalizada);
            categoriasData[catNormalizada] = {
                ...existente,
                ...(valor || {}),
                nombre: catNormalizada,
                grupos: Array.isArray(valor?.grupos) ? valor.grupos : [],
                eliminatoria: {
                    ...existente.eliminatoria,
                    ...(valor?.eliminatoria || {})
                }
            };
        });
    }

    const equiposNormalizados = Array.isArray(nube?.equipos)
        ? nube.equipos.map((eq) => ({
              ...eq,
              categoria: normalizarCategoria(eq.categoria)
          }))
        : [];

    const canchasNormalizadas = Array.isArray(nube?.canchas) && nube.canchas.length > 0
        ? nube.canchas.map((c) => (c || '').trim()).filter(Boolean)
        : base.canchas;

    const categoriaActiva = asegurarCategoria(nube?.categoriaActiva || base.categoriaActiva);

    return {
        ...base,
        ...(nube || {}),
        nombreTorneo: (nube?.nombreTorneo || base.nombreTorneo).trim() || base.nombreTorneo,
        categoriaActiva,
        canchas: canchasNormalizadas,
        equipos: equiposNormalizados,
        categoriasData
    };
}

async function cargarDesdeSupabase() {
    if (!supabaseClub || !empresaIdActual) {
        actualizarEstadoSync('Configura Supabase al activar licencia', 'text-red-300');
        return;
    }

    try {
        actualizarEstadoSync('Cargando desde Supabase...', 'text-cyan-300');

        const { data, error } = await supabaseClub
            .from(TABLA_TORNEOS)
            .select('estado_torneo')
            .eq('id', empresaIdActual)
            .maybeSingle();

        if (error) throw error;

        if (data && data.estado_torneo && typeof data.estado_torneo === 'object') {
            estado = hidratarEstadoDesdeObjeto(data.estado_torneo);
            renderTodoCalendario();
            actualizarEstadoSync('Conectado a Supabase', 'text-emerald-300');
        } else {
            await guardarEnSupabase();
        }
    } catch (err) {
        console.error('Error al cargar desde Supabase:', err);
        actualizarEstadoSync('Error al leer Supabase', 'text-red-300');
    }
}

async function guardarEnSupabase() {
    if (!supabaseClub || !empresaIdActual) {
        actualizarEstadoSync('Sin conexión a Supabase', 'text-red-300');
        return;
    }

    try {
        actualizarEstadoSync('Guardando en Supabase...', 'text-cyan-300');

        const { error } = await supabaseClub
            .from(TABLA_TORNEOS)
            .upsert(
                {
                    id: empresaIdActual,
                    empresa_id: empresaIdActual,
                    organizacion_nombre: nombreOrgActual,
                    estado_torneo: estado,
                    actualizado_en: new Date().toISOString()
                },
                { onConflict: 'id' }
            );

        if (error) throw error;
        actualizarEstadoSync('Guardado en Supabase', 'text-emerald-300');
    } catch (err) {
        console.error('Error al guardar en Supabase:', err);
        actualizarEstadoSync('Error al guardar en Supabase', 'text-red-300');
    }
}

function guardarEstado() {
    clearTimeout(temporizadorSync);
    temporizadorSync = setTimeout(() => {
        guardarEnSupabase();
    }, 250);
}

function obtenerEquipoPorId(id) {
    return (
        estado.equipos.find((e) => e.id === id) || {
            id,
            club: 'Equipo',
            categoria: estado.categoriaActiva,
            division: '-',
            rama: '-'
        }
    );
}

function obtenerListaCategoriasDisponibles() {
    const extras = new Set();

    Object.keys(estado.categoriasData || {}).forEach((cat) => {
        const normalizada = normalizarCategoria(cat);
        if (!CATEGORIAS_OFICIALES.includes(normalizada)) extras.add(normalizada);
    });

    estado.equipos.forEach((eq) => {
        const normalizada = normalizarCategoria(eq.categoria);
        if (!CATEGORIAS_OFICIALES.includes(normalizada)) extras.add(normalizada);
    });

    return [...CATEGORIAS_OFICIALES, ...Array.from(extras)];
}

function renderSelectorCategorias() {
    const select = document.getElementById('categoriaSelect');
    if (!select) return;

    const cats = obtenerListaCategoriasDisponibles();
    const activa = asegurarCategoria(estado.categoriaActiva);

    select.innerHTML = cats
        .map((cat) => `<option value="${cat}" ${cat === activa ? 'selected' : ''}>${cat}</option>`)
        .join('');
}

async function cambiarCategoria(nuevaCat) {
    estado.categoriaActiva = asegurarCategoria(nuevaCat);
    renderTodoCalendario();
    await guardarEnSupabase();
}

async function eliminarCancha(nombreCancha) {
    if (!Array.isArray(estado.canchas)) return;
    estado.canchas = estado.canchas.filter((c) => c !== nombreCancha);
    renderTodoCalendario();
    await guardarEnSupabase();
}

function obtenerPartidosCategoria(catNombre) {
    const cat = asegurarCategoria(catNombre);
    const catData = estado.categoriasData[cat] || crearEstructuraCategoria(cat);
    const lista = [];

    (catData.grupos || []).forEach((grupo, gIdx) => {
        (grupo.partidos || []).forEach((p, pIdx) => {
            lista.push({
                categoria: cat,
                origen: 'grupo',
                grupoIdx: gIdx,
                partidoIdx: pIdx,
                bloqueEtiqueta: grupo.nombre,
                partido: p
            });
        });
    });

    (catData.eliminatoria?.partidos || []).forEach((p, pIdx) => {
        lista.push({
            categoria: cat,
            origen: 'eliminatoria',
            grupoIdx: null,
            partidoIdx: pIdx,
            bloqueEtiqueta: `Eliminatoria (${p.ronda || catData.eliminatoria.rondaActual || 'Llave'})`,
            partido: p
        });
    });

    return lista;
}

function actualizarProgramacionPartido(origen, grupoIdx, partidoIdx, campo, valor) {
    const catData = obtenerDatosCategoriaActiva();
    const partido = origen === 'grupo'
        ? catData.grupos?.[grupoIdx]?.partidos?.[partidoIdx]
        : catData.eliminatoria?.partidos?.[partidoIdx];

    if (!partido) return;

    if (campo === 'orden') {
        const num = parseInt(valor, 10);
        partido.orden = Number.isNaN(num) ? 0 : Math.max(0, num);
    } else {
        partido[campo] = valor;
    }

    renderTodoCalendario();
    guardarEstado();
}

function renderResumenPorCancha() {
    const cont = document.getElementById('resumenPorCancha');
    if (!cont) return;

    const canchas = Array.isArray(estado.canchas) ? estado.canchas : [];
    const todasLasCategorias = obtenerListaCategoriasDisponibles();

    const mapaCanchas = {};
    canchas.forEach((c) => {
        mapaCanchas[c] = { asignaciones: new Set(), totalPartidos: 0 };
    });

    todasLasCategorias.forEach((cat) => {
        const items = obtenerPartidosCategoria(cat);
        items.forEach(({ bloqueEtiqueta, partido }) => {
            if (!partido.cancha) return;
            if (!mapaCanchas[partido.cancha]) {
                mapaCanchas[partido.cancha] = { asignaciones: new Set(), totalPartidos: 0 };
            }
            mapaCanchas[partido.cancha].asignaciones.add(`${cat} • ${bloqueEtiqueta}`);
            mapaCanchas[partido.cancha].totalPartidos += 1;
        });
    });

    const nombresCanchas = Object.keys(mapaCanchas);
    if (nombresCanchas.length === 0) {
        cont.innerHTML = `<div class="col-span-full bg-white rounded-2xl border border-slate-200 p-5 text-xs text-slate-500 font-semibold">Agrega una cancha arriba para comenzar a asignar categorías y grupos.</div>`;
        return;
    }

    cont.innerHTML = nombresCanchas.map((cancha) => {
        const info = mapaCanchas[cancha];
        const etiquetas = Array.from(info.asignaciones);

        return `
            <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-glass space-y-2.5">
                <div class="flex items-center justify-between">
                    <span class="font-black text-xs uppercase text-brand-electric">
                        <i class="fas fa-location-dot mr-1"></i> ${cancha}
                    </span>
                    <span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-black">
                        ${info.totalPartidos} partido(s)
                    </span>
                </div>

                ${
                    etiquetas.length === 0
                        ? `<p class="text-[11px] text-slate-400 font-semibold">Sin categorías o grupos asignados aún.</p>`
                        : `<div class="flex flex-wrap gap-1.5">
                            ${etiquetas.map((etq) => `<span class="px-2 py-1 rounded-lg bg-blue-50 text-slate-800 text-[11px] font-bold">${etq}</span>`).join('')}
                           </div>`
                }
            </div>
        `;
    }).join('');
}

function renderTodoCalendario() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const catData = obtenerDatosCategoriaActiva();
    const canchas = Array.isArray(estado.canchas) ? estado.canchas : [];

    const torneoEl = document.getElementById('nombreTorneoSubtitulo');
    if (torneoEl) torneoEl.textContent = estado.nombreTorneo || 'Torneo Oficial de Voleibol';

    const reglasEl = document.getElementById('resumenReglasCategoria');
    if (reglasEl) {
        const dias = catData.diasJuego ? `Días: ${catData.diasJuego}` : 'Días por definir';
        const cond = catData.condiciones ? `Condiciones: ${catData.condiciones}` : 'Sin condiciones extra';
        reglasEl.textContent = `${dias} • ${cond}`;
    }

    renderSelectorCategorias();

    const chipsCont = document.getElementById('listaCanchasChips');
    if (chipsCont) {
        chipsCont.innerHTML = canchas.length === 0
            ? `<span class="text-xs text-slate-400 font-semibold">No hay canchas agregadas todavía.</span>`
            : canchas.map((c) => `
                <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50 text-brand-electric text-xs font-black border border-brand-electric/20">
                    <i class="fas fa-volleyball text-[11px]"></i> ${c}
                    <button type="button" onclick="eliminarCancha('${c.replace(/'/g, "\\'")}')" title="Quitar cancha" class="text-slate-400 hover:text-red-600 cursor-pointer">
                        <i class="fas fa-times text-[11px]"></i>
                    </button>
                </span>
            `).join('');
    }

    const todosCategoria = obtenerPartidosCategoria(catActiva);

    const selGrupo = document.getElementById('filtroGrupo');
    if (selGrupo) {
        const prev = selGrupo.value || 'TODOS';
        const gruposUnicos = Array.from(new Set(todosCategoria.map((i) => i.bloqueEtiqueta)));
        selGrupo.innerHTML = `<option value="TODOS">Todos los grupos / fases</option>` +
            gruposUnicos.map((g) => `<option value="${g}" ${g === prev ? 'selected' : ''}>${g}</option>`).join('');
    }

    const selCancha = document.getElementById('filtroCancha');
    if (selCancha) {
        const prev = selCancha.value || 'TODAS';
        selCancha.innerHTML =
            `<option value="TODAS">Todas las canchas</option>` +
            `<option value="SIN_ASIGNAR" ${prev === 'SIN_ASIGNAR' ? 'selected' : ''}>Sin cancha asignada</option>` +
            canchas.map((c) => `<option value="${c}" ${c === prev ? 'selected' : ''}>${c}</option>`).join('');
    }

    // Detectar choques globales por cancha + día + hora entre todas las categorías
    const claveConteo = {};
    obtenerListaCategoriasDisponibles().forEach((cat) => {
        obtenerPartidosCategoria(cat).forEach(({ partido }) => {
            if (partido.cancha && partido.dia && partido.hora) {
                const clave = `${partido.cancha}__${partido.dia}__${partido.hora}`;
                claveConteo[clave] = (claveConteo[clave] || 0) + 1;
            }
        });
    });

    const choquesTotal = Object.values(claveConteo).filter((cnt) => cnt > 1).length;
    const alertaEl = document.getElementById('alertaChoques');
    if (alertaEl) {
        if (choquesTotal > 0) {
            alertaEl.classList.remove('hidden');
            alertaEl.innerHTML = `<i class="fas fa-triangle-exclamation mr-1"></i> ${choquesTotal} choque(s) de cancha, día y hora`;
        } else {
            alertaEl.classList.add('hidden');
            alertaEl.innerHTML = '';
        }
    }

    renderResumenPorCancha();

    const filtroGrupo = document.getElementById('filtroGrupo')?.value || 'TODOS';
    const filtroCancha = document.getElementById('filtroCancha')?.value || 'TODAS';
    const criterioOrden = document.getElementById('ordenPartidos')?.value || 'orden';

    const filtrados = todosCategoria.filter((item) => {
        const pasaGrupo = filtroGrupo === 'TODOS' || item.bloqueEtiqueta === filtroGrupo;
        const canchaPartido = item.partido.cancha || '';
        const pasaCancha =
            filtroCancha === 'TODAS' ||
            (filtroCancha === 'SIN_ASIGNAR' && !canchaPartido) ||
            canchaPartido === filtroCancha;
        return pasaGrupo && pasaCancha;
    });

    filtrados.sort((a, b) => {
        if (criterioOrden === 'hora') {
            const keyA = `${a.partido.dia || '9999-99-99'} ${a.partido.hora || '99:99'}`;
            const keyB = `${b.partido.dia || '9999-99-99'} ${b.partido.hora || '99:99'}`;
            return keyA.localeCompare(keyB);
        }
        if (criterioOrden === 'cancha') {
            return (a.partido.cancha || 'ZZZ').localeCompare(b.partido.cancha || 'ZZZ');
        }
        const ordA = a.partido.orden ?? a.partido.jornada ?? 999;
        const ordB = b.partido.orden ?? b.partido.jornada ?? 999;
        return ordA - ordB;
    });

    const tituloCat = document.getElementById('tituloCategoriaPartidos');
    if (tituloCat) tituloCat.textContent = catActiva;

    const totalMostrados = document.getElementById('totalPartidosMostrados');
    if (totalMostrados) totalMostrados.textContent = filtrados.length;

    const cont = document.getElementById('contenedorPartidosCalendario');
    if (!cont) return;

    if (filtrados.length === 0) {
        cont.innerHTML = `
            <div class="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                <p class="text-sm font-black text-slate-700">No hay partidos para mostrar en ${catActiva}</p>
                <p class="text-xs text-slate-500">Genera los grupos de <strong>${catActiva}</strong> en <strong>Match Control</strong> o cambia los filtros.</p>
            </div>
        `;
        return;
    }

    cont.innerHTML = filtrados.map(({ origen, grupoIdx, partidoIdx, bloqueEtiqueta, partido }) => {
        const eqA = obtenerEquipoPorId(partido.eqA);
        const eqB = obtenerEquipoPorId(partido.eqB);
        const tieneChoque =
            partido.cancha &&
            partido.dia &&
            partido.hora &&
            claveConteo[`${partido.cancha}__${partido.dia}__${partido.hora}`] > 1;

        const opcionesCancha = canchas.includes(partido.cancha) || !partido.cancha
            ? canchas
            : [...canchas, partido.cancha];

        return `
            <div class="bg-white rounded-2xl border ${tieneChoque ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200'} p-4 shadow-glass space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-black uppercase">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-1 rounded-lg bg-blue-50 text-brand-electric">${bloqueEtiqueta}</span>
                        <span class="text-slate-400">Jornada ${partido.jornada || partidoIdx + 1}</span>
                    </div>
                    <span class="${tieneChoque ? 'text-amber-700' : 'text-slate-500'}">
                        ${tieneChoque ? '<i class="fas fa-triangle-exclamation mr-1"></i>Choque de cancha y horario' : (partido.ganadorId ? `<span class="text-emerald-600">Resultado: ${partido.setsA}-${partido.setsB}</span>` : 'Pendiente')}
                    </span>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                    <div class="lg:col-span-4 font-black text-xs text-slate-900">
                        <span>${eqA.club}</span>
                        <span class="mx-2 text-brand-orange">VS</span>
                        <span>${eqB.club}</span>
                    </div>

                    <div class="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                            <label class="block text-[10px] font-extrabold uppercase text-slate-400 mb-0.5">Cancha</label>
                            <select onchange="actualizarProgramacionPartido('${origen}', ${grupoIdx}, ${partidoIdx}, 'cancha', this.value)" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-brand-electric">
                                <option value="">Sin cancha</option>
                                ${opcionesCancha.map((c) => `<option value="${c}" ${partido.cancha === c ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>

                        <div>
                            <label class="block text-[10px] font-extrabold uppercase text-slate-400 mb-0.5">Día</label>
                            <input type="date" value="${partido.dia || ''}" onchange="actualizarProgramacionPartido('${origen}', ${grupoIdx}, ${partidoIdx}, 'dia', this.value)" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-brand-electric">
                        </div>

                        <div>
                            <label class="block text-[10px] font-extrabold uppercase text-slate-400 mb-0.5">Hora</label>
                            <input type="time" value="${partido.hora || ''}" onchange="actualizarProgramacionPartido('${origen}', ${grupoIdx}, ${partidoIdx}, 'hora', this.value)" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-brand-electric">
                        </div>

                        <div>
                            <label class="block text-[10px] font-extrabold uppercase text-slate-400 mb-0.5">Orden</label>
                            <input type="number" min="1" max="999" placeholder="#" value="${partido.orden || ''}" onchange="actualizarProgramacionPartido('${origen}', ${grupoIdx}, ${partidoIdx}, 'orden', this.value)" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-brand-electric">
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
    inicializarSupabaseClub();

    const orgHeader = document.getElementById('orgHeaderInfo');
    if (orgHeader) {
        orgHeader.innerHTML = `${nombreOrgActual} • <span id="syncStatusTexto" class="text-[11px] font-bold text-slate-300">Iniciando...</span>`;
    }

    const formAgregarCancha = document.getElementById('formAgregarCancha');
    if (formAgregarCancha) {
        formAgregarCancha.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('nuevaCanchaNombre');
            const nombre = (input?.value || '').trim();
            if (!nombre) return;

            if (!Array.isArray(estado.canchas)) estado.canchas = [];
            const existe = estado.canchas.some((c) => c.toLowerCase() === nombre.toLowerCase());
            if (!existe) estado.canchas.push(nombre);

            input.value = '';
            renderTodoCalendario();
            await guardarEnSupabase();
        });
    }

    renderTodoCalendario();
    await cargarDesdeSupabase();
});

window.cambiarCategoria = cambiarCategoria;
window.eliminarCancha = eliminarCancha;
window.actualizarProgramacionPartido = actualizarProgramacionPartido;
window.renderTodoCalendario = renderTodoCalendario;
