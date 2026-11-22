import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CATEGORIAS_OFICIALES = ['U9', 'U11', 'U13', 'U15', 'U19', 'U21', 'Libre'];
const TABLA_TORNEOS = 'torneos_match_control';
const ETIQUETAS_DIA = {
    1: 'Lun',
    2: 'Mar',
    3: 'Mié',
    4: 'Jue',
    5: 'Vie',
    6: 'Sáb',
    0: 'Dom'
};

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
        diasTodosContraTodos: 1,
        grupos: [],
        eliminatoria: {
            rondaActual: null,
            partidos: [],
            campeon: null
        }
    };
}

function normalizarCanchas(rawCanchas, fallback) {
    if (!Array.isArray(rawCanchas) || rawCanchas.length === 0) {
        return fallback;
    }

    return rawCanchas
        .map((item) => {
            if (typeof item === 'string') {
                const nombre = item.trim();
                return nombre ? { nombre, diasSemana: [6, 0] } : null;
            }
            if (item && typeof item === 'object') {
                const nombre = (item.nombre || '').trim();
                if (!nombre) return null;
                const dias = Array.isArray(item.diasSemana)
                    ? item.diasSemana.map((d) => Number(d)).filter((d) => !Number.isNaN(d))
                    : [6, 0];
                return {
                    nombre,
                    diasSemana: dias.length > 0 ? Array.from(new Set(dias)) : [6, 0]
                };
            }
            return null;
        })
        .filter(Boolean);
}

function estadoInicial() {
    const categoriasData = {};
    CATEGORIAS_OFICIALES.forEach((cat) => {
        categoriasData[cat] = crearEstructuraCategoria(cat);
    });

    return {
        nombreTorneo: 'Torneo Oficial de Voleibol',
        categoriaActiva: 'U9',
        canchas: [
            { nombre: 'Cancha 1', diasSemana: [6, 0] },
            { nombre: 'Cancha 2', diasSemana: [6, 0] }
        ],
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
                cantidadGrupos: Math.max(
                    1,
                    Math.min(20, parseInt(valor?.cantidadGrupos, 10) || existente.cantidadGrupos || 2)
                ),
                diasTodosContraTodos: Math.max(
                    1,
                    Math.min(30, parseInt(valor?.diasTodosContraTodos, 10) || existente.diasTodosContraTodos || 1)
                ),
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

    const canchasNormalizadas = normalizarCanchas(nube?.canchas, base.canchas);
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

function obtenerCanchaObj(nombreCancha) {
    return (estado.canchas || []).find((c) => c.nombre === nombreCancha) || null;
}

function formatearDiasSemana(dias) {
    if (!Array.isArray(dias) || dias.length === 0) return 'Sin días definidos';
    const orden = [1, 2, 3, 4, 5, 6, 0];
    return orden
        .filter((d) => dias.includes(d))
        .map((d) => ETIQUETAS_DIA[d])
        .join(', ');
}

function calcularFechasDisponiblesEnSemana(fechaBaseStr, diasSemana) {
    const base = fechaBaseStr ? new Date(`${fechaBaseStr}T12:00:00`) : new Date();
    if (Number.isNaN(base.getTime())) return [];

    const diasActivos = Array.isArray(diasSemana) && diasSemana.length > 0
        ? diasSemana
        : [1, 2, 3, 4, 5, 6, 0];

    const fechas = [];
    for (let offset = 0; offset < 7; offset++) {
        const candidata = new Date(base);
        candidata.setDate(base.getDate() + offset);
        if (diasActivos.includes(candidata.getDay())) {
            const yyyy = candidata.getFullYear();
            const mm = String(candidata.getMonth() + 1).padStart(2, '0');
            const dd = String(candidata.getDate()).padStart(2, '0');
            fechas.push(`${yyyy}-${mm}-${dd}`);
        }
    }
    return fechas.length > 0 ? fechas : [fechaBaseStr].filter(Boolean);
}

async function alternarDiaCancha(nombreCancha, diaNum) {
    const canchaObj = obtenerCanchaObj(nombreCancha);
    if (!canchaObj) return;

    const actuales = new Set(canchaObj.diasSemana || []);
    if (actuales.has(diaNum)) {
        if (actuales.size > 1) actuales.delete(diaNum);
    } else {
        actuales.add(diaNum);
    }
    canchaObj.diasSemana = Array.from(actuales);

    renderTodoCalendario();
    await guardarEnSupabase();
}

async function eliminarCancha(nombreCancha) {
    estado.canchas = (estado.canchas || []).filter((c) => c.nombre !== nombreCancha);
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

function actualizarOpcionesSemana() {
    const categorias = obtenerListaCategoriasDisponibles();
    const selCat = document.getElementById('semCategoriaSelect');
    const selDiv = document.getElementById('semDivisionSelect');
    const selCancha = document.getElementById('semCanchaSelect');
    const contGrupos = document.getElementById('semGruposChecklist');
    if (!selCat || !selDiv || !selCancha || !contGrupos) return;

    const catElegida = asegurarCategoria(selCat.value || estado.categoriaActiva);
    if (!Array.from(selCat.options).some((o) => o.value === catElegida)) {
        selCat.innerHTML = categorias
            .map((c) => `<option value="${c}" ${c === catElegida ? 'selected' : ''}>${c}</option>`)
            .join('');
    }
    selCat.value = catElegida;

    const equiposCat = estado.equipos.filter((eq) => normalizarCategoria(eq.categoria) === catElegida);
    const divisiones = Array.from(
        new Set(equiposCat.map((eq) => (eq.division || '').trim()).filter(Boolean))
    );
    const divPrevia = selDiv.value;
    selDiv.innerHTML =
        `<option value="TODAS">Todas las divisiones</option>` +
        divisiones.map((d) => `<option value="${d}" ${d === divPrevia ? 'selected' : ''}>${d}</option>`).join('');

    const canchas = estado.canchas || [];
    const canchaPrevia = selCancha.value;
    selCancha.innerHTML = canchas.length === 0
        ? `<option value="">Agrega una cancha primero</option>`
        : canchas.map((c) => `<option value="${c.nombre}" ${c.nombre === canchaPrevia ? 'selected' : ''}>${c.nombre} (${formatearDiasSemana(c.diasSemana)})</option>`).join('');

    const catData = estado.categoriasData[catElegida] || crearEstructuraCategoria(catElegida);
    const grupos = Array.isArray(catData.grupos) ? catData.grupos : [];
    const tieneElim = Array.isArray(catData.eliminatoria?.partidos) && catData.eliminatoria.partidos.length > 0;

    const prevMarcados = Array.from(contGrupos.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value);

    const opcionesBloque = grupos.map((g) => ({ value: `GRUPO::${g.nombre}`, label: g.nombre }));
    if (tieneElim) {
        opcionesBloque.push({ value: 'ELIMINATORIA', label: `Eliminatoria (${catData.eliminatoria.rondaActual || 'Llave'})` });
    }

    if (opcionesBloque.length === 0) {
        contGrupos.innerHTML = `<span class="text-xs text-slate-400 font-semibold">No hay grupos generados en ${catElegida} todavía.</span>`;
        return;
    }

    const usarPrevios = prevMarcados.length > 0;
    contGrupos.innerHTML = opcionesBloque
        .map((op) => {
            const marcado = usarPrevios ? prevMarcados.includes(op.value) : true;
            return `
                <label class="cursor-pointer select-none">
                    <input type="checkbox" value="${op.value}" ${marcado ? 'checked' : ''} class="sr-only peer sem-grupo-check">
                    <span class="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-600 peer-checked:bg-brand-electric peer-checked:text-white peer-checked:border-brand-electric transition inline-block">
                        ${op.label}
                    </span>
                </label>
            `;
        })
        .join('');
}

async function cambiarCategoria(nuevaCat) {
    estado.categoriaActiva = asegurarCategoria(nuevaCat);
    const selSemCat = document.getElementById('semCategoriaSelect');
    if (selSemCat) selSemCat.value = estado.categoriaActiva;
    renderTodoCalendario();
    await guardarEnSupabase();
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

    const canchas = estado.canchas || [];
    const categorias = obtenerListaCategoriasDisponibles();

    const mapa = {};
    canchas.forEach((c) => {
        mapa[c.nombre] = {
            diasTexto: formatearDiasSemana(c.diasSemana),
            asignaciones: new Set(),
            totalPartidos: 0
        };
    });

    categorias.forEach((cat) => {
        obtenerPartidosCategoria(cat).forEach(({ bloqueEtiqueta, partido }) => {
            if (!partido.cancha) return;
            if (!mapa[partido.cancha]) {
                mapa[partido.cancha] = {
                    diasTexto: 'Días por definir',
                    asignaciones: new Set(),
                    totalPartidos: 0
                };
            }
            const divInfo = partido.divisionSemanal && partido.divisionSemanal !== 'TODAS'
                ? ` (${partido.divisionSemanal})`
                : '';
            const fechaInfo = partido.dia ? `${partido.dia} • ` : '';
            mapa[partido.cancha].asignaciones.add(`${fechaInfo}${cat}${divInfo} • ${bloqueEtiqueta}`);
            mapa[partido.cancha].totalPartidos += 1;
        });
    });

    const nombres = Object.keys(mapa);
    if (nombres.length === 0) {
        cont.innerHTML = `<div class="col-span-full bg-white rounded-2xl border border-slate-200 p-5 text-xs text-slate-500 font-semibold">Agrega una cancha arriba para comenzar.</div>`;
        return;
    }

    cont.innerHTML = nombres.map((cancha) => {
        const info = mapa[cancha];
        const items = Array.from(info.asignaciones);
        return `
            <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-glass space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="font-black text-xs uppercase text-brand-electric">
                        <i class="fas fa-location-dot mr-1"></i> ${cancha}
                    </span>
                    <span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-black">
                        ${info.totalPartidos} partido(s)
                    </span>
                </div>
                <p class="text-[11px] font-bold text-slate-500">
                    <i class="fas fa-calendar-week text-brand-orange mr-1"></i> Días: ${info.diasTexto}
                </p>
                ${
                    items.length === 0
                        ? `<p class="text-[11px] text-slate-400 font-semibold">Sin categorías o grupos asignados aún.</p>`
                        : `<div class="flex flex-wrap gap-1.5">
                            ${items.map((txt) => `<span class="px-2 py-1 rounded-lg bg-blue-50 text-slate-800 text-[11px] font-bold">${txt}</span>`).join('')}
                           </div>`
                }
            </div>
        `;
    }).join('');
}

function renderTodoCalendario() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const catData = obtenerDatosCategoriaActiva();
    const canchas = estado.canchas || [];
    const nombresCanchas = canchas.map((c) => c.nombre);

    const torneoEl = document.getElementById('nombreTorneoSubtitulo');
    if (torneoEl) torneoEl.textContent = estado.nombreTorneo || 'Torneo Oficial de Voleibol';

    const reglasEl = document.getElementById('resumenReglasCategoria');
    if (reglasEl) {
        const dias = catData.diasJuego ? `Días: ${catData.diasJuego}` : 'Días por definir';
        const cond = catData.condiciones ? `Condiciones: ${catData.condiciones}` : 'Sin condiciones extra';
        const diasTvT = catData.diasTodosContraTodos ? `Todos vs todos: ${catData.diasTodosContraTodos} día(s)` : '';
        reglasEl.textContent = [dias, cond, diasTvT].filter(Boolean).join(' • ');
    }

    const contCanchas = document.getElementById('listaCanchasConfiguradas');
    if (contCanchas) {
        contCanchas.innerHTML = canchas.length === 0
            ? `<div class="col-span-full text-xs text-slate-400 font-semibold">No hay canchas configuradas.</div>`
            : canchas.map((c) => {
                const diasSet = new Set(c.diasSemana || []);
                const botonesDia = [1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const activo = diasSet.has(d);
                    return `
                        <button type="button" onclick="alternarDiaCancha('${c.nombre.replace(/'/g, "\\'")}', ${d})"
                            class="px-2 py-1 rounded-lg text-[10px] font-black transition cursor-pointer ${
                                activo
                                    ? 'bg-brand-electric text-white'
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }">
                            ${ETIQUETAS_DIA[d]}
                        </button>
                    `;
                }).join('');

                return `
                    <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                        <div class="flex items-center justify-between">
                            <span class="font-black text-xs uppercase text-slate-900">
                                <i class="fas fa-volleyball text-brand-electric mr-1"></i> ${c.nombre}
                            </span>
                            <button type="button" onclick="eliminarCancha('${c.nombre.replace(/'/g, "\\'")}')" title="Quitar cancha" class="text-slate-400 hover:text-red-600 text-xs cursor-pointer">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                        <div class="flex flex-wrap gap-1">${botonesDia}</div>
                    </div>
                `;
            }).join('');
    }

    const selCatFiltro = document.getElementById('categoriaSelect');
    if (selCatFiltro) {
        const cats = obtenerListaCategoriasDisponibles();
        selCatFiltro.innerHTML = cats
            .map((cat) => `<option value="${cat}" ${cat === catActiva ? 'selected' : ''}>${cat}</option>`)
            .join('');
    }

    actualizarOpcionesSemana();
    renderResumenPorCancha();

    const todosCategoria = obtenerPartidosCategoria(catActiva);

    const selGrupo = document.getElementById('filtroGrupo');
    if (selGrupo) {
        const prev = selGrupo.value || 'TODOS';
        const gruposUnicos = Array.from(new Set(todosCategoria.map((i) => i.bloqueEtiqueta)));
        selGrupo.innerHTML = `<option value="TODOS">Todos los grupos / fases</option>` +
            gruposUnicos.map((g) => `<option value="${g}" ${g === prev ? 'selected' : ''}>${g}</option>`).join('');
    }

    const selCanchaFiltro = document.getElementById('filtroCancha');
    if (selCanchaFiltro) {
        const prev = selCanchaFiltro.value || 'TODAS';
        selCanchaFiltro.innerHTML =
            `<option value="TODAS">Todas las canchas</option>` +
            `<option value="SIN_ASIGNAR" ${prev === 'SIN_ASIGNAR' ? 'selected' : ''}>Sin cancha asignada</option>` +
            nombresCanchas.map((c) => `<option value="${c}" ${c === prev ? 'selected' : ''}>${c}</option>`).join('');
    }

    const selFechaFiltro = document.getElementById('filtroFecha');
    if (selFechaFiltro) {
        const prev = selFechaFiltro.value || 'TODAS';
        const fechasUnicas = Array.from(
            new Set(todosCategoria.map((i) => i.partido.dia).filter(Boolean))
        ).sort();
        selFechaFiltro.innerHTML =
            `<option value="TODAS">Todas las fechas</option>` +
            `<option value="SIN_FECHA" ${prev === 'SIN_FECHA' ? 'selected' : ''}>Sin fecha asignada</option>` +
            fechasUnicas.map((f) => `<option value="${f}" ${f === prev ? 'selected' : ''}>${f}</option>`).join('');
    }

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

    const filtroGrupo = document.getElementById('filtroGrupo')?.value || 'TODOS';
    const filtroCancha = document.getElementById('filtroCancha')?.value || 'TODAS';
    const filtroFecha = document.getElementById('filtroFecha')?.value || 'TODAS';
    const criterioOrden = document.getElementById('ordenPartidos')?.value || 'orden';

    const filtrados = todosCategoria.filter((item) => {
        const pasaGrupo = filtroGrupo === 'TODOS' || item.bloqueEtiqueta === filtroGrupo;
        const canchaPartido = item.partido.cancha || '';
        const pasaCancha =
            filtroCancha === 'TODAS' ||
            (filtroCancha === 'SIN_ASIGNAR' && !canchaPartido) ||
            canchaPartido === filtroCancha;
        const fechaPartido = item.partido.dia || '';
        const pasaFecha =
            filtroFecha === 'TODAS' ||
            (filtroFecha === 'SIN_FECHA' && !fechaPartido) ||
            fechaPartido === filtroFecha;
        return pasaGrupo && pasaCancha && pasaFecha;
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
        const ordA = a.partido.orden ?? a.partido.diaTodosContraTodos ?? a.partido.jornada ?? 999;
        const ordB = b.partido.orden ?? b.partido.diaTodosContraTodos ?? b.partido.jornada ?? 999;
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
                <p class="text-xs text-slate-500">Asigna manualmente los equipos a sus grupos y genera el todos contra todos de <strong>${catActiva}</strong> en <strong>Match Control</strong>.</p>
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

        const opcionesCancha = nombresCanchas.includes(partido.cancha) || !partido.cancha
            ? nombresCanchas
            : [...nombresCanchas, partido.cancha];

        const divEtq = eqA.division && eqA.division !== '-' ? ` • ${eqA.division}` : '';
        const diaTvT = partido.diaTodosContraTodos || partido.jornada || 1;

        return `
            <div class="bg-white rounded-2xl border ${tieneChoque ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200'} p-4 shadow-glass space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-black uppercase">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-1 rounded-lg bg-blue-50 text-brand-electric">${bloqueEtiqueta}${divEtq}</span>
                        <span class="text-slate-400">Día ${diaTvT}</span>
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
                            <label class="block text-[10px] font-extrabold uppercase text-slate-400 mb-0.5">Fecha</label>
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

    const fechaInicioInput = document.getElementById('semFechaInicio');
    if (fechaInicioInput && !fechaInicioInput.value) {
        const hoy = new Date();
        const yyyy = hoy.getFullYear();
        const mm = String(hoy.getMonth() + 1).padStart(2, '0');
        const dd = String(hoy.getDate()).padStart(2, '0');
        fechaInicioInput.value = `${yyyy}-${mm}-${dd}`;
    }

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

            const diasSeleccionados = Array.from(
                document.querySelectorAll('.dia-cancha-check:checked')
            ).map((cb) => Number(cb.value));

            const diasFinales = diasSeleccionados.length > 0 ? diasSeleccionados : [6, 0];
            if (!Array.isArray(estado.canchas)) estado.canchas = [];

            const existente = estado.canchas.find((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
            if (existente) {
                existente.diasSemana = diasFinales;
            } else {
                estado.canchas.push({ nombre, diasSemana: diasFinales });
            }

            input.value = '';
            renderTodoCalendario();
            await guardarEnSupabase();
        });
    }

    const formSemanal = document.getElementById('formProgramacionSemanal');
    if (formSemanal) {
        formSemanal.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cat = asegurarCategoria(document.getElementById('semCategoriaSelect')?.value || estado.categoriaActiva);
            const division = document.getElementById('semDivisionSelect')?.value || 'TODAS';
            const canchaNombre = document.getElementById('semCanchaSelect')?.value || '';
            const fechaBase = document.getElementById('semFechaInicio')?.value || '';
            const gruposMarcados = Array.from(
                document.querySelectorAll('.sem-grupo-check:checked')
            ).map((cb) => cb.value);

            const msgEl = document.getElementById('mensajeProgramacionSemanal');
            if (!canchaNombre) return;

            if (gruposMarcados.length === 0) {
                if (msgEl) {
                    msgEl.className = 'text-xs font-bold text-amber-700';
                    msgEl.textContent = 'Selecciona al menos un grupo o fase para asignar esta semana.';
                }
                return;
            }

            const todosItems = obtenerPartidosCategoria(cat);
            const seleccionados = todosItems.filter(({ bloqueEtiqueta, partido }) => {
                const coincideGrupo = gruposMarcados.some((val) => {
                    if (val === 'ELIMINATORIA') return bloqueEtiqueta.startsWith('Eliminatoria');
                    if (val.startsWith('GRUPO::')) return bloqueEtiqueta === val.replace('GRUPO::', '');
                    return false;
                });
                if (!coincideGrupo) return false;

                if (division === 'TODAS') return true;
                const eqA = obtenerEquipoPorId(partido.eqA);
                const eqB = obtenerEquipoPorId(partido.eqB);
                return eqA.division === division || eqB.division === division;
            });

            if (seleccionados.length === 0) {
                if (msgEl) {
                    msgEl.className = 'text-xs font-bold text-amber-700';
                    msgEl.textContent = `No hay partidos que coincidan con ${cat} / ${division} y los grupos elegidos.`;
                }
                return;
            }

            const canchaObj = obtenerCanchaObj(canchaNombre);
            const fechasDisponibles = calcularFechasDisponiblesEnSemana(fechaBase, canchaObj?.diasSemana);

            seleccionados.forEach(({ partido }, idx) => {
                partido.cancha = canchaNombre;
                partido.divisionSemanal = division;
                if (fechasDisponibles.length > 0) {
                    const diaIndice = ((partido.diaTodosContraTodos || partido.jornada || idx + 1) - 1 + Math.floor(idx / fechasDisponibles.length)) % fechasDisponibles.length;
                    partido.dia = fechasDisponibles[Math.max(0, diaIndice)];
                }
                if (!partido.orden) {
                    partido.orden = idx + 1;
                }
            });

            estado.categoriaActiva = cat;
            renderTodoCalendario();

            if (msgEl) {
                const gruposTexto = gruposMarcados
                    .map((g) => (g.startsWith('GRUPO::') ? g.replace('GRUPO::', '') : 'Eliminatoria'))
                    .join(', ');
                const divTexto = division === 'TODAS' ? 'todas las divisiones' : division;
                msgEl.className = 'text-xs font-bold text-emerald-700';
                msgEl.textContent = `Asignados ${seleccionados.length} juego(s) de ${cat} (${divTexto} • ${gruposTexto}) en ${canchaNombre} entre ${fechasDisponibles[0] || fechaBase} y ${fechasDisponibles[fechasDisponibles.length - 1] || fechaBase}.`;
            }

            await guardarEnSupabase();
        });
    }

    renderTodoCalendario();
    await cargarDesdeSupabase();
});

window.cambiarCategoria = cambiarCategoria;
window.alternarDiaCancha = alternarDiaCancha;
window.eliminarCancha = eliminarCancha;
window.actualizarOpcionesSemana = actualizarOpcionesSemana;
window.actualizarProgramacionPartido = actualizarProgramacionPartido;
window.renderTodoCalendario = renderTodoCalendario;
