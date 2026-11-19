import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const MASTER_SUPA_URL = "https://ajdimbptzoeqzrrioywt.supabase.co";
const MASTER_SUPA_KEY = "sb_publishable_aVydbrj88elb7XVq1yopFw_2U4MHgHv";
const RUTA_SISTEMA = "match.html";

const supabaseMaster = createClient(MASTER_SUPA_URL, MASTER_SUPA_KEY);
const getHardwareID = () => btoa(navigator.userAgent + navigator.language);

function esStandaloneActual() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function esEntornoLocal() {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function esDispositivoIos() {
    return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
}

function abrirVentanaInstalacion() {
    const modal = document.getElementById('modalInstalacion');
    const bloqueIos = document.getElementById('bloqueInstalarIos');
    const bloqueAndroidPc = document.getElementById('bloqueInstalarAndroidPc');
    const estadoModal = document.getElementById('estadoModalInstalar');

    if (!modal) return;

    if (esDispositivoIos()) {
        bloqueIos?.classList.remove('hidden');
        bloqueAndroidPc?.classList.add('hidden');
    } else {
        bloqueIos?.classList.add('hidden');
        bloqueAndroidPc?.classList.remove('hidden');
    }

    if (estadoModal) {
        estadoModal.className = "text-xs font-bold text-center text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5";
        estadoModal.innerText = "Serial validado. Instala la aplicación para continuar a Match Control.";
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarVentanaInstalacion() {
    const modal = document.getElementById('modalInstalacion');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

document.getElementById('btnCerrarModalInstalar')?.addEventListener('click', cerrarVentanaInstalacion);

// Al pulsar "Instalar Aplicación Ahora" dentro de la ventana flotante
document.getElementById('btnConfirmarInstalacionPWA')?.addEventListener('click', async () => {
    const estadoModal = document.getElementById('estadoModalInstalar');

    if (window.deferredPrompt) {
        if (estadoModal) {
            estadoModal.className = "text-xs font-bold text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5";
            estadoModal.innerText = "Mostrando solicitud de instalación...";
        }

        window.deferredPrompt.prompt();
        const userChoice = await window.deferredPrompt.userChoice;
        window.deferredPrompt = null;

        if (userChoice.outcome === 'accepted') {
            if (estadoModal) {
                estadoModal.className = "text-xs font-bold text-center text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5";
                estadoModal.innerText = "¡Instalación aceptada! Entrando a Match Control...";
            }
            setTimeout(() => window.location.replace(RUTA_SISTEMA), 400);
        } else {
            if (estadoModal) {
                estadoModal.className = "text-xs font-bold text-center text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5";
                estadoModal.innerText = "Debes aceptar la instalación para usar el acceso directo.";
            }
        }
    } else if (esStandaloneActual() || esEntornoLocal()) {
        window.location.replace(RUTA_SISTEMA);
    } else {
        if (estadoModal) {
            estadoModal.className = "text-xs font-bold text-center text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-2.5";
            estadoModal.innerText = "Usa el menú ⋮ del navegador para instalar Match Control y luego pulsa 'Entrar a Match Control'.";
        }
    }
});

// Botón "Entrar a Match Control" dentro de la ventana flotante
document.getElementById('btnEntrarMatch')?.addEventListener('click', () => {
    const estadoModal = document.getElementById('estadoModalInstalar');
    const licenciaOk = localStorage.getItem('licencia_validada') === 'true';

    if (!licenciaOk) {
        if (estadoModal) {
            estadoModal.className = "text-xs font-bold text-center text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5";
            estadoModal.innerText = "Primero debes validar un serial correcto.";
        }
        return;
    }

    if (esStandaloneActual() || esEntornoLocal()) {
        window.location.replace(RUTA_SISTEMA);
    } else if (estadoModal) {
        estadoModal.className = "text-xs font-bold text-center text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5";
        estadoModal.innerText = "Abre Match Control desde el acceso directo instalado en tu dispositivo.";
    }
});

// 1. Botón de pegado automático directo
const btnPegar = document.getElementById('btnPegarPortapapeles');
if (btnPegar) {
    btnPegar.addEventListener('click', async () => {
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                const textoCopiado = await navigator.clipboard.readText();
                document.getElementById('tokenInput').value = textoCopiado.trim();
                const statusDiv = document.getElementById('statusMsg');
                if (statusDiv) {
                    statusDiv.className = "text-xs font-bold text-emerald-600";
                    statusDiv.innerText = "¡Serial pegado! Ahora pulsa 'Validar Serial y Pedir Instalación'.";
                }
            } else {
                alert("Tu navegador no permite lectura automática. Mantén presionado el cuadro de texto para pegar.");
            }
        } catch (err) {
            alert("No se pudo acceder al portapapeles. Pega tu serial manualmente en el recuadro.");
        }
    });
}

// 2. Validar serial y abrir ventana flotante de instalación
async function procesarActivacionEInstalacion() {
    const rawToken = document.getElementById('tokenInput').value.trim();
    const statusDiv = document.getElementById('statusMsg');
    const btn = document.getElementById('btnActivarEInstalar');

    if (!rawToken) {
        return alert("Por favor, pega el serial de licencia primero.");
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Verificando serial...`;

    try {
        const data = JSON.parse(atob(rawToken));
        const hwID = getHardwareID();
        const activationId = data.clubId || data.activation_id || data.orgId;

        if (!activationId) {
            throw new Error("El serial no contiene un ID de organización válido.");
        }

        const { data: empresaData, error: empresaError } = await supabaseMaster
            .from('licencias')
            .select('*')
            .eq('id', activationId)
            .single();

        if (empresaError || !empresaData) {
            throw new Error("La licencia no existe en el sistema.");
        }

        if (empresaData.activa === false || empresaData.estado === 'suspendida') {
            throw new Error("Esta licencia se encuentra suspendida o inactiva.");
        }

        const fechaVence = empresaData.fecha_vencimiento || empresaData.vence || data.expira;
        if (fechaVence && new Date() > new Date(fechaVence)) {
            throw new Error(`La licencia venció el ${fechaVence}.`);
        }

        let equiposLicencia = Array.isArray(empresaData.equipos) ? empresaData.equipos : [];
        let limiteStr = empresaData.limite_dispositivos || data.limite || "3";
        let limiteLicencia = (limiteStr === "Ilimitado") ? 999 : (parseInt(limiteStr, 10) || 3);

        if (!equiposLicencia.includes(hwID) && equiposLicencia.length >= limiteLicencia) {
            alert("Error: Se alcanzó el límite de dispositivos permitidos para este serial.");
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-key text-sm"></i> Validar Serial y Pedir Instalación`;
            return;
        }

        if (!equiposLicencia.includes(hwID)) {
            equiposLicencia.push(hwID);
            await supabaseMaster
                .from('licencias')
                .update({ equipos: equiposLicencia })
                .eq('id', activationId);
        }

        localStorage.setItem('match_control_supa_url', empresaData.supabase_url || data.supabaseUrl || "");
        localStorage.setItem('match_control_supa_key', empresaData.supabase_key || data.supabaseKey || "");
        localStorage.setItem('match_control_supa_bucket', empresaData.bucket || data.bucket || activationId);

        const nombreOrg = empresaData.nombre || data.clubNombre || data.orgNombre || "Organización de Voleibol";
        localStorage.setItem('match_control_org_nombre', nombreOrg);
        localStorage.setItem('youcontrol_empresa_id', activationId);
        localStorage.setItem('licencia_validada', 'true');

        if (statusDiv) {
            statusDiv.className = "text-xs font-bold text-emerald-600";
            statusDiv.innerText = "¡Serial correcto! Revisa la ventana para instalar Match Control.";
        }

        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-key text-sm"></i> Validar Serial y Pedir Instalación`;

        // Si ya está corriendo como acceso directo instalado o en localhost, entra directo a match.html
        if (esStandaloneActual() || esEntornoLocal()) {
            setTimeout(() => window.location.replace(RUTA_SISTEMA), 350);
        } else {
            // Si está en el navegador web normal, abre la ventana flotante pidiendo instalar
            abrirVentanaInstalacion();
        }

    } catch (e) {
        console.error("Error al procesar activación:", e);
        if (statusDiv) {
            statusDiv.className = "text-xs font-bold text-red-600";
            statusDiv.innerText = e.message;
        }
        alert("Serial inválido: " + e.message);
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-key text-sm"></i> Validar Serial y Pedir Instalación`;
    }
}

const btnActivar = document.getElementById('btnActivarEInstalar');
if (btnActivar) {
    btnActivar.addEventListener('click', procesarActivacionEInstalacion);
}
