const STORAGE_KEY = 'match_control_torneo_v1';

let estado = cargarEstado();
let rondaPendienteConfirmar = 8;

function estadoInicial() {
    return {
        equipos: [],
        grupos: [],
        eliminatoria: {
            rondaActual: null,
            partidos: [],
            campeon: null
        }
    };
}

function cargarEstado() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return estadoInicial();
        return { ...estadoInicial(), ...JSON.parse(raw) };
    } catch (e) {
        return estadoInicial();
    }
}

function guardarEstado() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    actualizarBadges();
}

document.addEventListener('DOMContentLoaded', () => {
    const orgNombre =
        localStorage.getItem('control_voley_club_nombre') ||
        localStorage.getItem('youcontrol_empresa_id') ||
        'Organización de Voleibol';

    document.getElementById('orgHeaderInfo').textContent =
        `${orgNombre} • Máx. 3 Sets (Gana el primero en 2)`;

    const formEquipo = document.getElementById('formEquipo');
    if (formEquipo) {
        formEquipo.addEventListener('submit', (e) => {
            e.preventDefault();
            const nuevoEquipo = {
                id: 'eq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                club: document.getElementById('clubNombre').value.trim(),
                categoria: document.getElementById('categoriaEquipo').value.trim(),
                division: document.getElementById('divisionEquipo').value.trim(),
                rama: document.getElementById('ramaEquipo').value
            };

            estado.equipos.push(nuevoEquipo);
            guardarEstado();
            e.target.reset();
            renderEquipos();
        });
    }

    const btnConfirmarElim = document.getElementById('btnConfirmarElim');
    if (btnConfirmarElim) {
        btnConfirmarElim.addEventListener('click', () => {
            cerrarModalElim();
            generarEliminatoriaDesdeEstadistica(rondaPendienteConfirmar);
        });
    }

    renderEquipos();
    renderGruposYEstadistica();
    renderEliminatorias();
    actualizarBadges();
});

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

    if (vista === 'grupos') renderGruposYEstadistica();
    if (vista === 'eliminatorias') renderEliminatorias();
}

function actualizarBadges() {
    document.getElementById('badgeEquipos').textContent = estado.equipos.length;
    const totalPartidosGrupo = estado.grupos.reduce((acc, g) => acc + g.partidos.length, 0);
    document.getElementById('badgePartidosGrupo').textContent = totalPartidosGrupo;
    document.getElementById('badgeRondaActual').textContent = estado.eliminatoria.rondaActual || 'Pendiente';
}

function eliminarEquipo(id) {
    estado.equipos = estado.equipos.filter((eq) => eq.id !== id);
    guardarEstado();
    renderEquipos();
}

function renderEquipos() {
    const filtroRama = document.getElementById('filtroRama').value;
    const filtrados =
        filtroRama === 'TODAS'
            ? estado.equipos
            : estado.equipos.filter((eq) => eq.rama === filtroRama);

    document.getElementById('totalEquiposTexto').textContent = filtrados.length;
    const tbody = document.getElementById('tablaEquiposBody');

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 font-bold">No hay equipos registrados con este filtro.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtrados
        .map(
            (eq, idx) => `
        <tr class="hover:bg-slate-50">
            <td class="py-3 px-3 text-slate-400">${idx + 1}</td>
            <td class="py-3 px-3 font-black text-slate-900">${eq.club}</td>
            <td class="py-3 px-3"><span class="px-2.5 py-1 rounded-lg bg-blue-50 text-brand-electric font-bold">${eq.categoria}</span></td>
            <td class="py-3 px-3 text-slate-700">${eq.division}</td>
            <td class="py-3 px-3">
                <span class="px-2.5 py-1 rounded-lg text-[11px] font-black ${eq.rama === 'Femenino' ? 'bg-pink-50 text-pink-600' : 'bg-indigo-50 text-indigo-600'}">
                    ${eq.rama}
                </span>
            </td>
            <td class="py-3 px-3 text-right">
                <button onclick="eliminarEquipo('${eq.id}')" class="text-red-500 hover:text-red-700 font-bold text-xs cursor-pointer">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `
        )
        .join('');
}

function generarFaseGrupos() {
    const filtroRama = document.getElementById('filtroRama').value;
    const poolEquipos =
        filtroRama === 'TODAS'
            ? [...estado.equipos]
            : estado.equipos.filter((eq) => eq.rama === filtroRama);

    if (poolEquipos.length < 2) {
        alert('Necesitas al menos 2 equipos registrados para programar la fase de grupos.');
        return;
    }

    let numGrupos = parseInt(document.getElementById('cantidadGrupos').value, 10) || 1;
    numGrupos = Math.min(numGrupos, poolEquipos.length);

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
                    id: `grp_${gIdx}_p_${i}_${j}`,
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

    estado.grupos = gruposTemp;
    guardarEstado();
    renderGruposYEstadistica();
    cambiarVista('grupos');
}

function obtenerEquipoPorId(id) {
    return (
        estado.equipos.find((e) => e.id === id) || {
            id,
            club: 'Equipo eliminado',
            categoria: '-',
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
    const partido = estado.grupos[grupoIdx].partidos[partidoIdx];
    partido.sets[setIdx][lado] = valor;

    const evalRes = evaluarSetsPartido(partido.sets);
    partido.setsA = evalRes.setsA;
    partido.setsB = evalRes.setsB;
    partido.ptsA = evalRes.ptsA;
    partido.ptsB = evalRes.ptsB;

    if (evalRes.ganadorLado === 'A') partido.ganadorId = partido.eqA;
    else if (evalRes.ganadorLado === 'B') partido.ganadorId = partido.eqB;
    else partido.ganadorId = null;

    guardarEstado();
    renderGruposYEstadistica();
}

function calcularClasificacionGeneral() {
    const statsMap = {};

    estado.equipos.forEach((eq) => {
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

    estado.grupos.forEach((grupo) => {
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
    const cont = document.getElementById('contenedorGrupos');

    if (estado.grupos.length === 0) {
        cont.innerHTML = `
            <div class="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                <p class="text-sm font-black text-slate-700">Aún no se ha generado la fase de grupos</p>
                <p class="text-xs text-slate-500">Ve a <strong>1. Registro de Equipos</strong>, indica la cantidad de grupos y presiona <strong>Generar Grupos y Calendario</strong>.</p>
            </div>
        `;
    } else {
        cont.innerHTML = estado.grupos
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
                            <h3 class="text-base font-black uppercase text-brand-electric">${grupo.nombre}</h3>
                            <span class="text-xs font-bold text-slate-500">${grupo.equiposIds.length} equipos • ${grupo.partidos.length} partidos</span>
                        </div>
                        <div class="space-y-3">${partidosHtml}</div>
                    </div>
                `;
            })
            .join('');
    }

    const ranking = calcularClasificacionGeneral();
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
            <td class="py-3 px-2 text-[11px] text-slate-500">${row.equipo.rama} • ${row.equipo.categoria} • ${row.equipo.division}</td>
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
    rondaPendienteConfirmar = tamanoLlave;
    const nombreRonda = tamanoLlave === 16 ? '16vos de Final' : '8vos de Final';
    document.getElementById('modalElimTitulo').textContent = `¿Pasar a ${nombreRonda}?`;
    document.getElementById('modalElimTexto').innerHTML = `
        Se tomarán los <strong>${tamanoLlave} mejores equipos</strong> según su <strong>porcentaje (%) y estadística</strong> en la ronda clasificatoria, emparejando el <strong>#1 contra el #${tamanoLlave}</strong>, el <strong>#2 contra el #${tamanoLlave - 1}</strong> y así sucesivamente. ¿Deseas generar esta ronda ahora?
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

function generarEliminatoriaDesdeEstadistica(tamanoLlave) {
    const ranking = calcularClasificacionGeneral();
    if (ranking.length < 2) {
        alert('Se requieren al menos 2 equipos para iniciar eliminatorias.');
        return;
    }

    const cantidadClasificados = Math.min(tamanoLlave, ranking.length);
    const seleccionados = ranking.slice(0, cantidadClasificados).map((r) => r.equipo);

    let etiqueta = '8vos';
    if (tamanoLlave === 16) etiqueta = '16vos';
    else if (tamanoLlave === 8) etiqueta = '8vos';
    else if (tamanoLlave === 4) etiqueta = '4tos';
    else if (tamanoLlave === 2) etiqueta = 'Final';

    estado.eliminatoria = {
        rondaActual: etiqueta,
        partidos: emparejarMejorContraPeor(seleccionados, etiqueta),
        campeon: null
    };

    guardarEstado();
    renderEliminatorias();
    cambiarVista('eliminatorias');
}

function actualizarSetElim(partidoIdx, setIdx, lado, valor) {
    const partido = estado.eliminatoria.partidos[partidoIdx];
    partido.sets[setIdx][lado] = valor;

    const evalRes = evaluarSetsPartido(partido.sets);
    partido.setsA = evalRes.setsA;
    partido.setsB = evalRes.setsB;

    if (evalRes.ganadorLado === 'A') partido.ganadorId = partido.eqA;
    else if (evalRes.ganadorLado === 'B') partido.ganadorId = partido.eqB;
    else partido.ganadorId = null;

    guardarEstado();
    renderEliminatorias();
}

function avanzarSiguienteRondaElim() {
    const elim = estado.eliminatoria;
    const todosResueltos = elim.partidos.length > 0 && elim.partidos.every((p) => p.ganadorId !== null);

    if (!todosResueltos) {
        alert('Completa el resultado de todos los partidos de la ronda actual (gana quien logre 2 sets).');
        return;
    }

    const ganadores = elim.partidos.map((p) => obtenerEquipoPorId(p.ganadorId));

    if (elim.rondaActual === 'Final' || ganadores.length === 1) {
        elim.rondaActual = 'Campeon';
        elim.campeon = ganadores[0];
        guardarEstado();
        renderEliminatorias();
        return;
    }

    let siguienteEtiqueta = '4tos';
    if (elim.rondaActual === '16vos') siguienteEtiqueta = '8vos';
    else if (elim.rondaActual === '8vos') siguienteEtiqueta = '4tos';
    else if (elim.rondaActual === '4tos') siguienteEtiqueta = 'Semifinal';
    else if (elim.rondaActual === 'Semifinal') siguienteEtiqueta = 'Final';

    elim.rondaActual = siguienteEtiqueta;
    elim.partidos = emparejarMejorContraPeor(ganadores, siguienteEtiqueta);
    guardarEstado();
    renderEliminatorias();
}

function renderEliminatorias() {
    const elim = estado.eliminatoria;
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

    document.getElementById('tituloRondaElim').textContent = elim.rondaActual
        ? nombresRondas[elim.rondaActual] || elim.rondaActual
        : 'Sin ronda eliminatoria iniciada';

    bannerCampeon.classList.toggle('hidden', elim.rondaActual !== 'Campeon' || !elim.campeon);
    if (elim.campeon) {
        document.getElementById('nombreCampeon').textContent = elim.campeon.club;
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
                <p class="text-sm font-black text-slate-700">No hay llaves eliminatorias generadas</p>
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

function resetearTorneoCompleto() {
    if (confirm('¿Deseas borrar el torneo actual y empezar uno nuevo en Match Control?')) {
        estado = estadoInicial();
        guardarEstado();
        renderEquipos();
        renderGruposYEstadistica();
        renderEliminatorias();
        cambiarVista('equipos');
    }
}
