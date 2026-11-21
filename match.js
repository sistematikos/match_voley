import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CATEGORIAS_OFICIALES = ['U9', 'U11', 'U13', 'U15', 'U19', 'U21', 'Libre'];
const TABLA_TORNEOS = 'torneos_match_control';

let estado = estadoInicial();
let rondaPendienteConfirmar = 8;
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

    const categoriaActiva = asegurarCategoria(nube?.categoriaActiva || base.categoriaActiva);

    return {
        ...base,
        ...(nube || {}),
        nombreTorneo: (nube?.nombreTorneo || base.nombreTorneo).trim() || base.nombreTorneo,
        categoriaActiva,
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
            renderTodo();
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
    actualizarBadges();

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
    actualizarBadges();
    clearTimeout(temporizadorSync);
    temporizadorSync = setTimeout(() => {
        guardarEnSupabase();
    }, 250);
}

document.addEventListener('DOMContentLoaded', async () => {
    inicializarSupabaseClub();

    const orgHeader = document.getElementById('orgHeaderInfo');
    if (orgHeader) {
        orgHeader.innerHTML = `${nombreOrgActual} • Máx. 3 Sets (Gana 2) • <span id="syncStatusTexto" class="text-[11px] font-bold text-slate-300">Iniciando...</span>`;
    }

    const formEquipo = document.getElementById('formEquipo');
    if (formEquipo) {
        formEquipo.addEventListener('submit', async (e) => {
            e.preventDefault();
            const catEquipo = asegurarCategoria(document.getElementById('categoriaEquipo').value);
            const nuevoEquipo = {
                id: 'eq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                club: document.getElementById('clubNombre').value.trim(),
                categoria: catEquipo,
                division: document.getElementById('divisionEquipo').value.trim(),
                rama: document.getElementById('ramaEquipo').value
            };

            estado.equipos.push(nuevoEquipo);
            estado.categoriaActiva = catEquipo;
            e.target.reset();
            renderTodo();
            await guardarEnSupabase();
        });
    }

    const formEditarEquipo = document.getElementById('formEditarEquipo');
    if (formEditarEquipo) {
        formEditarEquipo.addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardarEdicionEquipo();
        });
    }

    const btnConfirmarElim = document.getElementById('btnConfirmarElim');
    if (btnConfirmarElim) {
        btnConfirmarElim.addEventListener('click', async () => {
            cerrarModalElim();
            await generarEliminatoriaDesdeEstadistica(rondaPendienteConfirmar);
        });
    }

    renderTodo();
    await cargarDesdeSupabase();
});

function abrirModalEditarEquipo(id) {
    const eq = estado.equipos.find((item) => item.id === id);
    if (!eq) return;

    document.getElementById('editEquipoId').value = eq.id;
    document.getElementById('editClubNombre').value = eq.club || '';
    document.getElementById('editCategoriaEquipo').value = normalizarCategoria(eq.categoria);
    document.getElementById('editDivisionEquipo').value = eq.division || '';
    document.getElementById('editRamaEquipo').value = eq.rama || 'Femenino';

    const modal = document.getElementById('modalEditarEquipo');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function cerrarModalEditarEquipo() {
    const modal = document.getElementById('modalEditarEquipo');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function guardarEdicionEquipo() {
    const id = document.getElementById('editEquipoId').value;
    const idx = estado.equipos.findIndex((item) => item.id === id);
    if (idx === -1) return;

    const nuevoClub = document.getElementById('editClubNombre').value.trim();
    const nuevaCat = asegurarCategoria(document.getElementById('editCategoriaEquipo').value);
    const nuevaDiv = document.getElementById('editDivisionEquipo').value.trim();
    const nuevaRama = document.getElementById('editRamaEquipo').value;

    if (!nuevoClub || !nuevaDiv) return;

    estado.equipos[idx] = {
        ...estado.equipos[idx],
        club: nuevoClub,
        categoria: nuevaCat,
        division: nuevaDiv,
        rama: nuevaRama
    };

    estado.categoriaActiva = nuevaCat;
    cerrarModalEditarEquipo();
    renderTodo();
    await guardarEnSupabase();
}

function obtenerListaCategoriasDisponibles() {
    const extras = new Set();

    Object.keys(estado.categoriasData || {}).forEach((cat) => {
        const normalizada = normalizarCategoria(cat);
        if (!CATEGORIAS_OFICIALES.includes(normalizada)) {
            extras.add(normalizada);
        }
    });

    estado.equipos.forEach((eq) => {
        const normalizada = normalizarCategoria(eq.categoria);
        if (!CATEGORIAS_OFICIALES.includes(normalizada)) {
            extras.add(normalizada);
        }
    });

    return [...CATEGORIAS_OFICIALES, ...Array.from(extras)];
}

function renderSelectorCategorias() {
    const select = document.getElementById('categoriaActivaSelect');
    if (!select) return;

    const cats = obtenerListaCategoriasDisponibles();
    const activa = asegurarCategoria(estado.categoriaActiva);

    select.innerHTML = cats
        .map((cat) => `<option value="${cat}" ${cat === activa ? 'selected' : ''}>${cat}</option>`)
        .join('');
}

async function cambiarCategoriaActiva(nuevaCat) {
    estado.categoriaActiva = asegurarCategoria(nuevaCat);
    renderTodo();
    await guardarEnSupabase();
}

async function actualizarDatosTorneo() {
    const input = document.getElementById('nombreTorneoInput');
    if (input) {
        estado.nombreTorneo = input.value.trim() || 'Torneo Oficial de Voleibol';
        await guardarEnSupabase();
    }
}

async function actualizarReglaCategoria() {
    const catData = obtenerDatosCategoriaActiva();
    catData.diasJuego = document.getElementById('diasJuegoCategoria')?.value.trim() || '';
    catData.condiciones = document.getElementById('condicionesCategoria')?.value.trim() || '';
    await guardarEnSupabase();
}

function actualizarCantidadGruposInput(valor) {
    const catData = obtenerDatosCategoriaActiva();
    const num = parseInt(valor, 10);
    catData.cantidadGrupos = Number.isNaN(num) || num < 1 ? 1 : Math.min(num, 20);
    renderResumenGruposCategoria();
    guardarEstado();
}

function cambiarVista(vista) {
    ['equipos', 'grupos', 'eliminatorias'].forEach((v) => {
        document.getElementById(`vista-${v}`).classList.toggle('hidden', v !== vista);
        const btn = document.getElementById(`tab-${v}`);
        if (v === vista) {
            btn.className =
                'p-4 rounded-2xl bg-brand-electric text-white font-black text-xs uppercase tracking-wider flex items-center justify-between shadow-electric transition cursor-pointer';
        } else {
            btn.className =
                'p-4 rounded-2xl bg-white text-slate-700 border border-slate-200 hover:border-brand-electric font-black text-xs uppercase tracking-wider flex items-center justify-between transition cursor-pointer';
        }
    });

    renderTodo();
}

function obtenerEquiposDeCategoriaFiltrados() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const filtroRama = document.getElementById('filtroRama')?.value || 'TODAS';

    return estado.equipos.filter((eq) => {
        const mismaCat = normalizarCategoria(eq.categoria) === catActiva;
        const mismaRama = filtroRama === 'TODAS' || eq.rama === filtroRama;
        return mismaCat && mismaRama;
    });
}

function actualizarBadges() {
    const catData = obtenerDatosCategoriaActiva();
    const equiposCat = obtenerEquiposDeCategoriaFiltrados();

    document.getElementById('badgeEquipos').textContent = equiposCat.length;
    const totalPartidosGrupo = (catData.grupos || []).reduce((acc, g) => acc + g.partidos.length, 0);
    document.getElementById('badgePartidosGrupo').textContent = totalPartidosGrupo;
    document.getElementById('badgeRondaActual').textContent = catData.eliminatoria?.rondaActual || 'Pendiente';
}

async function eliminarEquipo(id) {
    estado.equipos = estado.equipos.filter((eq) => eq.id !== id);
    renderTodo();
    await guardarEnSupabase();
}

function renderResumenGruposCategoria() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const catData = obtenerDatosCategoriaActiva();
    const equiposCat = obtenerEquiposDeCategoriaFiltrados();
    const inputGrupos = document.getElementById('cantidadGrupos');
    const resumen = document.getElementById('resumenGruposSugeridos');

    if (inputGrupos) {
        inputGrupos.value = catData.cantidadGrupos || 2;
    }

    if (resumen) {
        const gruposEfectivos = Math.min(catData.cantidadGrupos || 1, Math.max(equiposCat.length, 1));
        resumen.textContent = equiposCat.length > 0
            ? `En ${catActiva} hay ${equiposCat.length} equipo(s) → se formarán ${gruposEfectivos} grupo(s) al generar.`
            : `Registra equipos en ${catActiva} para armar sus grupos.`;
    }
}

function renderEquipos() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const filtrados = obtenerEquiposDeCategoriaFiltrados();

    document.getElementById('tituloCategoriaEquipos').textContent = catActiva;
    document.getElementById('totalEquiposTexto').textContent = filtrados.length;
    renderResumenGruposCategoria();

    const tbody = document.getElementById('tablaEquiposBody');

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 font-bold">No hay equipos registrados en ${catActiva} con este filtro.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtrados
        .map(
            (eq, idx) => `
        <tr class="hover:bg-slate-50">
            <td class="py-3 px-3 text-slate-400">${idx + 1}</td>
            <td class="py-3 px-3 font-black text-slate-900">${eq.club}</td>
            <td class="py-3 px-3"><span class="px-2.5 py-1 rounded-lg bg-blue-50 text-brand-electric font-bold">${normalizarCategoria(eq.categoria)}</span></td>
            <td class="py-3 px-3 text-slate-700">${eq.division}</td>
            <td class="py-3 px-3">
                <span class="px-2.5 py-1 rounded-lg text-[11px] font-black ${eq.rama === 'Femenino' ? 'bg-pink-50 text-pink-600' : 'bg-indigo-50 text-indigo-600'}">
                    ${eq.rama}
                </span>
            </td>
            <td class="py-3 px-3 text-right">
                <div class="inline-flex items-center gap-3">
                    <button type="button" onclick="abrirModalEditarEquipo('${eq.id}')" title="Editar equipo" class="text-brand-electric hover:text-brand-700 font-bold text-xs cursor-pointer">
                        <i class="fas fa-pen-to-square"></i>
                    </button>
                    <button type="button" onclick="eliminarEquipo('${eq.id}')" title="Eliminar equipo" class="text-red-500 hover:text-red-700 font-bold text-xs cursor-pointer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `
        )
        .join('');
}

async function generarFaseGruposCategoria() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const catData = obtenerDatosCategoriaActiva();
    const poolEquipos = obtenerEquiposDeCategoriaFiltrados();

    if (poolEquipos.length < 2) {
        alert(`Necesitas al menos 2 equipos en la categoría "${catActiva}" para generar grupos.`);
        return;
    }

    let numGrupos = parseInt(document.getElementById('cantidadGrupos').value, 10) || catData.cantidadGrupos || 1;
    numGrupos = Math.min(Math.max(numGrupos, 1), poolEquipos.length);
    catData.cantidadGrupos = numGrupos;

    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const gruposTemp = Array.from({ length: numGrupos }, (_, i) => ({
        nombre: `Grupo ${letras[i] || i + 1}`,
        equiposIds: [],
        partidos: []
    }));

    poolEquipos.forEach((eq, index) => {
        const grupoIdx = index % numGrupos;
        gruposTemp[grupoIdx].equiposIds.push(eq.id);
    });

    gruposTemp.forEach((grupo, gIdx) => {
        const ids = grupo.equiposIds;
        let jornadaNum = 1;
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                grupo.partidos.push({
                    id: `grp_${catActiva}_${gIdx}_p_${i}_${j}`,
                    jornada: jornadaNum++,
                    eqA: ids[i],
                    eqB: ids[j],
                    sets: [
                        { a: '', b: '' },
                        { a: '', b: '' },
                        { a: '', b: '' }
                    ],
                    ganadorId: null,
                    setsA: 0,
                    setsB: 0,
                    ptsA: 0,
                    ptsB: 0
                });
            }
        }
    });

    catData.grupos = gruposTemp;
    renderTodo();
    cambiarVista('grupos');
    await guardarEnSupabase();
}

function obtenerEquipoPorId(id) {
    return (
        estado.equipos.find((e) => e.id === id) || {
            id,
            club: 'Equipo eliminado',
            categoria: estado.categoriaActiva,
            division: '-',
            rama: '-'
        }
    );
}

// Máximo 3 sets: gana el primero en llegar a 2 sets
function evaluarSetsPartido(setsRaw) {
    let setsA = 0;
    let setsB = 0;
    let ptsA = 0;
    let ptsB = 0;

    for (let i = 0; i < 3; i++) {
        if (setsA === 2 || setsB === 2) break;

        const valA = setsRaw[i].a === '' ? null : parseInt(setsRaw[i].a, 10);
        const valB = setsRaw[i].b === '' ? null : parseInt(setsRaw[i].b, 10);

        if (valA !== null && valB !== null && !Number.isNaN(valA) && !Number.isNaN(valB)) {
            ptsA += valA;
            ptsB += valB;
            if (valA > valB) setsA++;
            else if (valB > valA) setsB++;
        }
    }

    let ganadorLado = null;
    if (setsA >= 2) ganadorLado = 'A';
    else if (setsB >= 2) ganadorLado = 'B';

    return { setsA, setsB, ptsA, ptsB, ganadorLado };
}

function actualizarSetGrupo(grupoIdx, partidoIdx, setIdx, lado, valor) {
    const catData = obtenerDatosCategoriaActiva();
    const partido = catData.grupos[grupoIdx].partidos[partidoIdx];
    partido.sets[setIdx][lado] = valor;

    const evalRes = evaluarSetsPartido(partido.sets);
    partido.setsA = evalRes.setsA;
    partido.setsB = evalRes.setsB;
    partido.ptsA = evalRes.ptsA;
    partido.ptsB = evalRes.ptsB;

    if (evalRes.ganadorLado === 'A') partido.ganadorId = partido.eqA;
    else if (evalRes.ganadorLado === 'B') partido.ganadorId = partido.eqB;
    else partido.ganadorId = null;

    renderGruposYEstadistica();
    guardarEstado();
}

function calcularClasificacionCategoria() {
    const catData = obtenerDatosCategoriaActiva();
    const poolEquipos = obtenerEquiposDeCategoriaFiltrados();
    const statsMap = {};

    poolEquipos.forEach((eq) => {
        statsMap[eq.id] = {
            equipo: eq,
            grupoNombre: '-',
            pj: 0,
            pg: 0,
            pp: 0,
            sf: 0,
            sc: 0,
            pf: 0,
            pc: 0,
            pct: 0
        };
    });

    (catData.grupos || []).forEach((grupo) => {
        grupo.equiposIds.forEach((id) => {
            if (statsMap[id]) statsMap[id].grupoNombre = grupo.nombre;
        });

        grupo.partidos.forEach((p) => {
            if (!p.ganadorId) return;
            const a = statsMap[p.eqA];
            const b = statsMap[p.eqB];
            if (!a || !b) return;

            a.pj++;
            b.pj++;
            a.sf += p.setsA;
            a.sc += p.setsB;
            b.sf += p.setsB;
            b.sc += p.setsA;
            a.pf += p.ptsA;
            a.pc += p.ptsB;
            b.pf += p.ptsB;
            b.pc += p.ptsA;

            if (p.ganadorId === p.eqA) {
                a.pg++;
                b.pp++;
            } else {
                b.pg++;
                a.pp++;
            }
        });
    });

    const lista = Object.values(statsMap).map((item) => {
        item.pct = item.pj > 0 ? Number(((item.pg / item.pj) * 100).toFixed(1)) : 0;
        item.ratioSets = item.sc > 0 ? item.sf / item.sc : item.sf;
        return item;
    });

    lista.sort((x, y) => {
        if (y.pct !== x.pct) return y.pct - x.pct;
        if (y.pg !== x.pg) return y.pg - x.pg;
        if (y.ratioSets !== x.ratioSets) return y.ratioSets - x.ratioSets;
        if (y.sf !== x.sf) return y.sf - x.sf;
        return y.pf - x.pf;
    });

    return lista;
}

function renderGruposYEstadistica() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const catData = obtenerDatosCategoriaActiva();
    const cont = document.getElementById('contenedorGrupos');

    document.getElementById('etiquetaCatGrupos').textContent = `Categoría: ${catActiva}`;
    document.getElementById('tituloCatTabla').textContent = catActiva;

    if (!catData.grupos || catData.grupos.length === 0) {
        cont.innerHTML = `
            <div class="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                <p class="text-sm font-black text-slate-700">Aún no se han generado los grupos de ${catActiva}</p>
                <p class="text-xs text-slate-500">Ve a <strong>1. Registro de Equipos</strong>, indica cuántos grupos tendrá <strong>${catActiva}</strong> y presiona <strong>Generar Grupos de la Categoría</strong>.</p>
            </div>
        `;
    } else {
        cont.innerHTML = catData.grupos
            .map((grupo, gIdx) => {
                const partidosHtml = grupo.partidos
                    .map((p, pIdx) => {
                        const eqA = obtenerEquipoPorId(p.eqA);
                        const eqB = obtenerEquipoPorId(p.eqB);
                        const tercerSetBloqueado =
                            (p.setsA === 2 || p.setsB === 2) &&
                            p.sets[2].a === '' &&
                            p.sets[2].b === '';

                        return `
                            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                                <div class="flex items-center justify-between text-[11px] font-black text-slate-400 uppercase">
                                    <span>Partido #${pIdx + 1} • Jornada ${p.jornada}</span>
                                    <span>${p.ganadorId ? `<span class="text-emerald-600"><i class="fas fa-check-circle mr-1"></i>Ganador: ${obtenerEquipoPorId(p.ganadorId).club}</span>` : 'Pendiente (Gana 2 sets)'}</span>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-12 items-center gap-3">
                                    <div class="md:col-span-4 flex items-center justify-between bg-white p-2.5 rounded-xl border ${p.ganadorId === p.eqA ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200'}">
                                        <span class="font-black text-xs text-slate-900 truncate">${eqA.club}</span>
                                        <span class="ml-2 px-2 py-0.5 rounded-md bg-brand-electric text-white font-black text-xs">${p.setsA}</span>
                                    </div>

                                    <div class="md:col-span-4 flex items-center justify-center gap-1.5">
                                        ${[0, 1, 2]
                                            .map(
                                                (sIdx) => `
                                            <div class="flex flex-col items-center bg-white p-1.5 rounded-xl border border-slate-200">
                                                <span class="text-[9px] font-black text-slate-400 uppercase mb-0.5">S${sIdx + 1}</span>
                                                <div class="flex items-center gap-1">
                                                    <input type="number" min="0" max="50" value="${p.sets[sIdx].a}"
                                                        ${sIdx === 2 && tercerSetBloqueado ? 'disabled' : ''}
                                                        onchange="actualizarSetGrupo(${gIdx}, ${pIdx}, ${sIdx}, 'a', this.value)"
                                                        class="w-9 p-1 text-center text-xs font-black border border-slate-200 rounded bg-slate-50">
                                                    <span class="text-slate-400 font-bold">:</span>
                                                    <input type="number" min="0" max="50" value="${p.sets[sIdx].b}"
                                                        ${sIdx === 2 && tercerSetBloqueado ? 'disabled' : ''}
                                                        onchange="actualizarSetGrupo(${gIdx}, ${pIdx}, ${sIdx}, 'b', this.value)"
                                                        class="w-9 p-1 text-center text-xs font-black border border-slate-200 rounded bg-slate-50">
                                                </div>
                                            </div>
                                        `
                                            )
                                            .join('')}
                                    </div>

                                    <div class="md:col-span-4 flex items-center justify-between bg-white p-2.5 rounded-xl border ${p.ganadorId === p.eqB ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200'}">
                                        <span class="font-black text-xs text-slate-900 truncate">${eqB.club}</span>
                                        <span class="ml-2 px-2 py-0.5 rounded-md bg-brand-orange text-white font-black text-xs">${p.setsB}</span>
                                    </div>
                                </div>
                            </div>
                        `;
                    })
                    .join('');

                return `
                    <div class="bg-white rounded-3xl border border-slate-200 p-6 shadow-glass space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 class="text-base font-black uppercase text-brand-electric">${grupo.nombre} • ${catActiva}</h3>
                            <span class="text-xs font-bold text-slate-500">${grupo.equiposIds.length} equipos • ${grupo.partidos.length} partidos</span>
                        </div>
                        <div class="space-y-3">${partidosHtml}</div>
                    </div>
                `;
            })
            .join('');
    }

    const ranking = calcularClasificacionCategoria();
    const tbody = document.getElementById('tablaEstadisticaBody');
    tbody.innerHTML = ranking
        .map(
            (row, idx) => `
        <tr class="hover:bg-slate-50">
            <td class="py-3 px-2">
                <span class="w-6 h-6 inline-flex items-center justify-center rounded-lg text-[11px] font-black ${idx < 8 ? 'bg-brand-electric text-white' : 'bg-slate-100 text-slate-600'}">
                    #${idx + 1}
                </span>
            </td>
            <td class="py-3 px-3 text-slate-900 font-black">${row.equipo.club}</td>
            <td class="py-3 px-2 text-slate-600">${row.grupoNombre}</td>
            <td class="py-3 px-2 text-[11px] text-slate-500">${row.equipo.rama} • ${row.equipo.division}</td>
            <td class="py-3 px-2 text-center">${row.pj}</td>
            <td class="py-3 px-2 text-center text-emerald-600">${row.pg}</td>
            <td class="py-3 px-2 text-center text-red-500">${row.pp}</td>
            <td class="py-3 px-2 text-center"><span class="px-2 py-1 rounded-lg bg-blue-50 text-brand-electric font-black">${row.pct}%</span></td>
            <td class="py-3 px-2 text-center">${row.sf} / ${row.sc}</td>
            <td class="py-3 px-2 text-center">${row.pf} / ${row.pc}</td>
        </tr>
    `
        )
        .join('');
}

function solicitarPaseEliminatoria(tamanoLlave) {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    rondaPendienteConfirmar = tamanoLlave;
    const nombreRonda = tamanoLlave === 16 ? '16vos de Final' : '8vos de Final';
    document.getElementById('modalElimTitulo').textContent = `¿Pasar ${catActiva} a ${nombreRonda}?`;
    document.getElementById('modalElimTexto').innerHTML = `
        Se tomarán hasta <strong>${tamanoLlave} mejores equipos</strong> de <strong>${catActiva}</strong> según su <strong>porcentaje (%) y estadística</strong>, emparejando el <strong>#1 contra el peor</strong>, el <strong>#2 contra el penúltimo</strong> y así sucesivamente. ¿Generar cruces ahora?
    `;
    const modal = document.getElementById('modalEliminatoria');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarModalElim() {
    const modal = document.getElementById('modalEliminatoria');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function emparejarMejorContraPeor(listaOrdenada, rondaEtiqueta) {
    const partidos = [];
    const mitad = Math.floor(listaOrdenada.length / 2);

    for (let i = 0; i < mitad; i++) {
        const mejor = listaOrdenada[i];
        const peor = listaOrdenada[listaOrdenada.length - 1 - i];

        partidos.push({
            id: `${rondaEtiqueta}_${i}_${Date.now()}`,
            ronda: rondaEtiqueta,
            seedA: i + 1,
            seedB: listaOrdenada.length - i,
            eqA: mejor.id,
            eqB: peor.id,
            sets: [
                { a: '', b: '' },
                { a: '', b: '' },
                { a: '', b: '' }
            ],
            setsA: 0,
            setsB: 0,
            ganadorId: null
        });
    }
    return partidos;
}

async function generarEliminatoriaDesdeEstadistica(tamanoLlave) {
    const catData = obtenerDatosCategoriaActiva();
    const ranking = calcularClasificacionCategoria();

    if (ranking.length < 2) {
        alert('Se requieren al menos 2 equipos en la categoría para iniciar eliminatorias.');
        return;
    }

    const cantidadClasificados = Math.min(tamanoLlave, ranking.length);
    const seleccionados = ranking.slice(0, cantidadClasificados).map((r) => r.equipo);

    let etiqueta = '8vos';
    if (tamanoLlave === 16) etiqueta = '16vos';
    else if (tamanoLlave === 8) etiqueta = '8vos';
    else if (tamanoLlave === 4) etiqueta = '4tos';
    else if (tamanoLlave === 2) etiqueta = 'Final';

    catData.eliminatoria = {
        rondaActual: etiqueta,
        partidos: emparejarMejorContraPeor(seleccionados, etiqueta),
        campeon: null
    };

    renderTodo();
    cambiarVista('eliminatorias');
    await guardarEnSupabase();
}

function actualizarSetElim(partidoIdx, setIdx, lado, valor) {
    const catData = obtenerDatosCategoriaActiva();
    const partido = catData.eliminatoria.partidos[partidoIdx];
    partido.sets[setIdx][lado] = valor;

    const evalRes = evaluarSetsPartido(partido.sets);
    partido.setsA = evalRes.setsA;
    partido.setsB = evalRes.setsB;

    if (evalRes.ganadorLado === 'A') partido.ganadorId = partido.eqA;
    else if (evalRes.ganadorLado === 'B') partido.ganadorId = partido.eqB;
    else partido.ganadorId = null;

    renderEliminatorias();
    guardarEstado();
}

async function avanzarSiguienteRondaElim() {
    const catData = obtenerDatosCategoriaActiva();
    const elim = catData.eliminatoria;
    const todosResueltos = elim.partidos.length > 0 && elim.partidos.every((p) => p.ganadorId !== null);

    if (!todosResueltos) {
        alert('Completa el resultado de todos los partidos de la ronda actual (gana quien logre 2 sets).');
        return;
    }

    const ganadores = elim.partidos.map((p) => obtenerEquipoPorId(p.ganadorId));

    if (elim.rondaActual === 'Final' || ganadores.length === 1) {
        elim.rondaActual = 'Campeon';
        elim.campeon = ganadores[0];
        renderEliminatorias();
        await guardarEnSupabase();
        return;
    }

    let siguienteEtiqueta = '4tos';
    if (elim.rondaActual === '16vos') siguienteEtiqueta = '8vos';
    else if (elim.rondaActual === '8vos') siguienteEtiqueta = '4tos';
    else if (elim.rondaActual === '4tos') siguienteEtiqueta = 'Semifinal';
    else if (elim.rondaActual === 'Semifinal') siguienteEtiqueta = 'Final';

    elim.rondaActual = siguienteEtiqueta;
    elim.partidos = emparejarMejorContraPeor(ganadores, siguienteEtiqueta);
    renderEliminatorias();
    await guardarEnSupabase();
}

function renderEliminatorias() {
    const catActiva = asegurarCategoria(estado.categoriaActiva);
    const catData = obtenerDatosCategoriaActiva();
    const elim = catData.eliminatoria || { rondaActual: null, partidos: [], campeon: null };
    const cont = document.getElementById('contenedorEliminatorias');
    const btnAvanzar = document.getElementById('btnAvanzarSiguienteRonda');
    const bannerCampeon = document.getElementById('campeonBanner');

    const nombresRondas = {
        '16vos': '16vos de Final',
        '8vos': '8vos de Final',
        '4tos': '4tos de Final',
        Semifinal: 'Semifinal',
        Final: 'Gran Final',
        Campeon: 'Torneo Finalizado'
    };

    document.getElementById('etiquetaRondaElim').textContent = `Categoría: ${catActiva}`;
    document.getElementById('tituloRondaElim').textContent = elim.rondaActual
        ? `${nombresRondas[elim.rondaActual] || elim.rondaActual} • ${catActiva}`
        : `Sin ronda eliminatoria iniciada en ${catActiva}`;

    bannerCampeon.classList.toggle('hidden', elim.rondaActual !== 'Campeon' || !elim.campeon);
    if (elim.campeon) {
        document.getElementById('nombreCampeon').textContent = `${elim.campeon.club} (${catActiva})`;
    }

    const todosListos = elim.partidos.length > 0 && elim.partidos.every((p) => p.ganadorId !== null);
    btnAvanzar.classList.toggle('hidden', !todosListos || elim.rondaActual === 'Campeon');

    if (elim.rondaActual === 'Semifinal') {
        btnAvanzar.innerHTML = `<i class="fas fa-trophy mr-1"></i> Pasar a la Gran Final`;
    } else {
        btnAvanzar.innerHTML = `<i class="fas fa-forward-step mr-1"></i> Avanzar a Siguiente Ronda`;
    }

    if (!elim.partidos || elim.partidos.length === 0) {
        cont.innerHTML = `
            <div class="md:col-span-2 bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                <p class="text-sm font-black text-slate-700">No hay llaves eliminatorias generadas para ${catActiva}</p>
                <p class="text-xs text-slate-500">Usa los botones de <strong>Iniciar desde 16vos</strong> o <strong>Iniciar desde 8vos</strong> para emparejar el mejor equipo contra el peor según estadística.</p>
            </div>
        `;
        return;
    }

    cont.innerHTML = elim.partidos
        .map((p, pIdx) => {
            const eqA = obtenerEquipoPorId(p.eqA);
            const eqB = obtenerEquipoPorId(p.eqB);
            const tercerSetBloqueado =
                (p.setsA === 2 || p.setsB === 2) &&
                p.sets[2].a === '' &&
                p.sets[2].b === '';

            return `
                <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-glass space-y-4">
                    <div class="flex items-center justify-between text-[11px] font-black uppercase text-slate-400">
                        <span>${nombresRondas[p.ronda] || p.ronda} • Llave ${pIdx + 1}</span>
                        <span class="text-brand-electric">Mejor (#${p.seedA}) vs Peor (#${p.seedB})</span>
                    </div>

                    <div class="space-y-2">
                        <div class="flex items-center justify-between p-3 rounded-xl border ${p.ganadorId === p.eqA ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}">
                            <div class="truncate">
                                <span class="text-[10px] font-black text-slate-400 mr-1">#${p.seedA}</span>
                                <span class="font-black text-xs text-slate-900">${eqA.club}</span>
                            </div>
                            <span class="px-2.5 py-1 rounded-lg bg-brand-electric text-white font-black text-xs">${p.setsA}</span>
                        </div>

                        <div class="flex items-center justify-between p-3 rounded-xl border ${p.ganadorId === p.eqB ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}">
                            <div class="truncate">
                                <span class="text-[10px] font-black text-slate-400 mr-1">#${p.seedB}</span>
                                <span class="font-black text-xs text-slate-900">${eqB.club}</span>
                            </div>
                            <span class="px-2.5 py-1 rounded-lg bg-brand-orange text-white font-black text-xs">${p.setsB}</span>
                        </div>
                    </div>

                    <div class="flex items-center justify-center gap-2 pt-1">
                        ${[0, 1, 2]
                            .map(
                                (sIdx) => `
                            <div class="flex flex-col items-center bg-slate-50 p-2 rounded-xl border border-slate-200">
                                <span class="text-[9px] font-black text-slate-400 uppercase mb-1">Set ${sIdx + 1}</span>
                                <div class="flex items-center gap-1">
                                    <input type="number" min="0" max="50" value="${p.sets[sIdx].a}"
                                        ${sIdx === 2 && tercerSetBloqueado ? 'disabled' : ''}
                                        onchange="actualizarSetElim(${pIdx}, ${sIdx}, 'a', this.value)"
                                        class="w-10 p-1 text-center text-xs font-black border border-slate-200 rounded bg-white">
                                    <span class="text-slate-400 font-bold">:</span>
                                    <input type="number" min="0" max="50" value="${p.sets[sIdx].b}"
                                        ${sIdx === 2 && tercerSetBloqueado ? 'disabled' : ''}
                                        onchange="actualizarSetElim(${pIdx}, ${sIdx}, 'b', this.value)"
                                        class="w-10 p-1 text-center text-xs font-black border border-slate-200 rounded bg-white">
                                </div>
                            </div>
                        `
                            )
                            .join('')}
                    </div>

                    <div class="text-center text-xs font-black">
                        ${
                            p.ganadorId
                                ? `<span class="text-emerald-600"><i class="fas fa-trophy mr-1"></i>Clasifica: ${obtenerEquipoPorId(p.ganadorId).club}</span>`
                                : `<span class="text-slate-400">Ingresa puntos de sets (gana el primero en 2 sets)</span>`
                        }
                    </div>
                </div>
            `;
        })
        .join('');
}

function renderTodo() {
    const catData = obtenerDatosCategoriaActiva();
    const inputTorneo = document.getElementById('nombreTorneoInput');
    const inputDias = document.getElementById('diasJuegoCategoria');
    const inputCond = document.getElementById('condicionesCategoria');

    if (inputTorneo) inputTorneo.value = estado.nombreTorneo || '';
    if (inputDias) inputDias.value = catData.diasJuego || '';
    if (inputCond) inputCond.value = catData.condiciones || '';

    renderSelectorCategorias();
    renderEquipos();
    renderGruposYEstadistica();
    renderEliminatorias();
    actualizarBadges();
}

async function resetearTorneoCompleto() {
    if (confirm('¿Deseas borrar el torneo actual y empezar uno nuevo en Match Control?')) {
        estado = estadoInicial();
        renderTodo();
        cambiarVista('equipos');
        await guardarEnSupabase();
    }
}

window.cambiarVista = cambiarVista;
window.cambiarCategoriaActiva = cambiarCategoriaActiva;
window.actualizarDatosTorneo = actualizarDatosTorneo;
window.actualizarReglaCategoria = actualizarReglaCategoria;
window.actualizarCantidadGruposInput = actualizarCantidadGruposInput;
window.abrirModalEditarEquipo = abrirModalEditarEquipo;
window.cerrarModalEditarEquipo = cerrarModalEditarEquipo;
window.eliminarEquipo = eliminarEquipo;
window.generarFaseGruposCategoria = generarFaseGruposCategoria;
window.actualizarSetGrupo = actualizarSetGrupo;
window.solicitarPaseEliminatoria = solicitarPaseEliminatoria;
window.cerrarModalElim = cerrarModalElim;
window.actualizarSetElim = actualizarSetElim;
window.avanzarSiguienteRondaElim = avanzarSiguienteRondaElim;
window.resetearTorneoCompleto = resetearTorneoCompleto;
