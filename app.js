import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const MASTER_SUPA_URL = "https://ajdimbptzoeqzrrioywt.supabase.co";
const MASTER_SUPA_KEY = "sb_publishable_aVydbrj88elb7XVq1yopFw_2U4MHgHv";
const RUTA_SISTEMA = "match.html";

const supabaseMaster = createClient(MASTER_SUPA_URL, MASTER_SUPA_KEY);
const getHardwareID = () => btoa(navigator.userAgent + navigator.language);

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
                    statusDiv.innerText = "¡Serial pegado con éxito!";
                }
            } else {
                alert("Tu navegador no permite lectura automática. Mantén presionado el cuadro de texto.");
            }
        } catch (err) {
            alert("No se pudo acceder al portapapeles. Mantén presionado el recuadro para pegar tu serial.");
        }
    });
}

// 2. Proceso de activación exclusivo por Serial de Licencia
async function procesarActivacionEInstalacion() {
    const rawToken = document.getElementById('tokenInput').value.trim();
    const statusDiv = document.getElementById('statusMsg');
    const btn = document.getElementById('btnActivarEInstalar');

    if (!rawToken) {
        return alert("Por favor, pega el serial de licencia de Match Control primero.");
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
            throw new Error("La licencia no existe en el sistema de Match Control.");
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
            btn.innerHTML = `<i class="fas fa-download text-sm"></i> Activar Licencia e Instalar`;
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

        if (window.deferredPrompt) {
            if (statusDiv) {
                statusDiv.className = "text-xs font-bold text-amber-600";
                statusDiv.innerText = "Confirmando instalación de Match Control...";
            }

            window.deferredPrompt.prompt();
            const userChoice = await window.deferredPrompt.userChoice;
            window.deferredPrompt = null;

            if (userChoice.outcome === 'accepted') {
                if (statusDiv) {
                    statusDiv.className = "text-xs font-bold text-emerald-600";
                    statusDiv.innerText = "¡Match Control instalado! Abriendo sistema...";
                }
                setTimeout(() => window.location.replace(RUTA_SISTEMA), 350);
            } else {
                alert("Debes instalar el acceso directo para usar Match Control.");
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-download text-sm"></i> Activar Licencia e Instalar`;
            }
        } else {
            if (statusDiv) {
                statusDiv.className = "text-xs font-bold text-emerald-600";
                statusDiv.innerText = "Serial correcto. Abriendo Match Control...";
            }
            setTimeout(() => window.location.replace(RUTA_SISTEMA), 350);
        }

    } catch (e) {
        console.error("Error al procesar activación:", e);
        if (statusDiv) {
            statusDiv.className = "text-xs font-bold text-red-600";
            statusDiv.innerText = e.message;
        }
        alert("No se pudo activar Match Control: " + e.message);
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-download text-sm"></i> Activar Licencia e Instalar`;
    }
}

const btnActivar = document.getElementById('btnActivarEInstalar');
if (btnActivar) {
    btnActivar.addEventListener('click', procesarActivacionEInstalacion);
}
