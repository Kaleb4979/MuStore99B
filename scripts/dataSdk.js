// =========================================================
// == 1. CONFIGURACIÓN CRÍTICA (CLAVES E INICIALIZACIÓN) ==
// =========================================================

// --- JSONBin Config ---
const BIN_ID = '691ddaa6ae596e708f6321c9'; 
const SECRET_KEY = '$2a$10$6.Y19X/sB3np.3CIJmbJZesuwRVxU77ns.FyAdL2dUc46k1vWFG9S'; 
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
const DB_KEY = 'mu_marketplace_db_v22_final';

// --- Supabase Config ---
const SUPABASE_URL = 'https://ciysaobejtxfkpmbmswb.supabase.co'; 
// ⚠️ TU CLAVE ANÓNIMA REAL DEBE ESTAR AQUÍ
const SUPABASE_ANON_KEY = 'sb_publishable_ZVQXNGvJjurUNtqZNQrnPg_aw_wW9gY'; 
const CHAT_TABLE_NAME = 'messages'; 

// --- Inicialización de Clientes ---
let supabase = null;
let chatSubscription = null; // Para guardar el canal de Realtime

// La función showToast se definirá en app.js, pero la necesitamos para el error de Supabase aquí
// La definimos como una función vacía temporalmente para evitar ReferenceError si app.js no está cargado
function showToast(message) {
    if (window.app && window.app.showToast) {
        window.app.showToast(message);
    } else {
        console.log("TOAST:", message);
    }
}


if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("✅ Cliente Supabase inicializado y listo para usar Realtime.");
} else {
    console.warn("❌ Supabase no inicializado. Chat funcionará en modo local simulado.");
}


// =========================================================
// == 2. ESTADO BASE y MOCK/SDKs GLOBALES                  ==
// =========================================================

// Base de datos simulada (para mantener la estructura)
window.mockDb = {
    data: [], 
    handler: null,
    notify() {} 
};

// SDK de Configuración Visual (Local)
window.elementSdk = {
    config: {},
    init: (options) => {
        window.elementSdk.config = options.defaultConfig;
        if(options.onConfigChange) options.onConfigChange(options.defaultConfig);
    },
    setConfig: (newConfig) => {
        window.elementSdk.config = { ...window.elementSdk.config, ...newConfig };
    }
};


// =========================================================
// == 3. SDK DE DATOS (JSONBin CRUD)                       ==
// =========================================================
window.dataSdk = {
    init: async (handler) => {
        window.mockDb.handler = handler;
        return window.dataSdk.read();
    },
    read: async () => {
        if (!BIN_ID || !SECRET_KEY) {
             console.error("JSONBin Config Error: BIN_ID o SECRET_KEY no configurados.");
             // Usar fallback local...
             const localData = localStorage.getItem(DB_KEY);
             window.mockDb.data = localData ? JSON.parse(localData) : [];
             window.mockDb.handler.onDataChanged(window.mockDb.data);
             return { isOk: false };
        }
        
        try {
            const response = await fetch(JSONBIN_URL + '/latest', {
                 method: 'GET',
                 headers: { 'X-Master-Key': SECRET_KEY }
            });
            if (!response.ok) throw new Error(`Error ${response.status}: ${await response.text()}`);
            const json = await response.json();
            const data = json.record || []; 
            localStorage.setItem(DB_KEY, JSON.stringify(data));
            window.mockDb.data = data;
            window.mockDb.handler.onDataChanged(data); 
            return { isOk: true };
        } catch (error) {
            console.error("JSONBin READ Error:", error);
            // ... (lógica de fallback local) ...
             const localData = localStorage.getItem(DB_KEY);
             window.mockDb.data = localData ? JSON.parse(localData) : [];
             window.mockDb.handler.onDataChanged(window.mockDb.data);
            return { isOk: false };
        }
    },
    write: async (newData) => {
        if (!BIN_ID || !SECRET_KEY) return { isOk: false };
        
        try {
            const response = await fetch(JSONBIN_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Master-Key': SECRET_KEY },
                body: JSON.stringify(newData)
            });
            if (!response.ok) throw new Error(`Error ${response.status}: ${await response.text()}`);
            localStorage.setItem(DB_KEY, JSON.stringify(newData));
            window.mockDb.data = newData;
            window.mockDb.handler.onDataChanged(newData);
            return { isOk: true, item: null };
        } catch (error) {
            console.error("JSONBin WRITE Error:", error);
            return { isOk: false };
        }
    },
    create: async (item) => {
        item.__backendId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const newData = [...window.mockDb.data, item];
        const result = await window.dataSdk.write(newData);
        return { isOk: result.isOk, item: item };
    },
    update: async (item) => {
        const index = window.mockDb.data.findIndex(i => i.__backendId === item.__backendId);
        if (index === -1) return { isOk: false };
        const newData = [...window.mockDb.data];
        newData[index] = {...item}; 
        const result = await window.dataSdk.write(newData);
        return { isOk: result.isOk, item: result.isOk ? newData[index] : null };
    },
    delete: async (item) => {
        const newData = window.mockDb.data.filter(i => i.__backendId !== item.__backendId);
        const result = await window.dataSdk.write(newData);
        return { isOk: result.isOk };
    }
};


// =========================================================
// == 4. SDK DE CHAT (SUPABASE REALTIME)                   ==
// =========================================================
window.chatSdk = {
    
    // Función central para obtener mensajes del historial
    getMessages: async (orderId) => {
        if (!supabase) return [];
        
        const { data, error } = await supabase
            .from(CHAT_TABLE_NAME)
            .select('id, sender, content, created_at, order_id')
            .eq('order_id', orderId)
            .order('created_at', { ascending: true });
            
        if (error) {
            console.error('Error al obtener mensajes de Supabase:', error);
            showToast('❌ Error al cargar mensajes del chat.');
            return [];
        }
        return data.map(msg => ({
            ...msg,
            timestamp: msg.created_at
        }));
    },

    // Función central para enviar un mensaje
    sendMessage: async (orderId, sender, content) => {
        if (!supabase || !content.trim()) return;
        
        const { error } = await supabase
            .from(CHAT_TABLE_NAME)
            .insert([{ order_id: orderId, sender: sender, content: content }]);
            
        if (error) {
            console.error('Error al enviar mensaje a Supabase:', error);
            showToast('❌ Error al enviar mensaje.');
        }
    },

    // Manejador de cambios de Realtime (Definido en app.js)
    handleRealtimeChange: null,

    // Función para iniciar la suscripción
    subscribeToOrder: async (orderId, handler) => {
        if (!supabase) {
            showToast('⚠️ Supabase no configurado. Chat en modo simulado/local.');
            return;
        }
        
        // Limpiar suscripción anterior
        window.chatSdk.unsubscribe();
        
        // Cargar mensajes iniciales
        let initialMessages = await window.chatSdk.getMessages(orderId);
        
        // Guardar el manejador (para que app.js pueda llamar a la actualización)
        window.chatSdk.handleRealtimeChange = (payload) => {
             if (payload.eventType === 'INSERT' && payload.new) {
                const newMessage = {
                    id: payload.new.id,
                    sender: payload.new.sender,
                    content: payload.new.content,
                    timestamp: payload.new.created_at || new Date().toISOString()
                };
                handler.onMessageReceived(newMessage);
            }
        };

        // Crear la suscripción
        chatSubscription = supabase
            .channel(`chat-order-${orderId}`) 
            .on(
                'postgres_changes',
                { 
                    event: 'INSERT', 
                    schema: 'public', 
                    table: CHAT_TABLE_NAME, 
                    filter: `order_id=eq.${orderId}` 
                },
                window.chatSdk.handleRealtimeChange
            )
            .subscribe();
        
        showToast('💬 Chat Realtime iniciado con Supabase.');
        return initialMessages; // Devolver los mensajes iniciales
    },

    // Función para cerrar la suscripción
    unsubscribe: () => {
        if (chatSubscription) {
            supabase.removeChannel(chatSubscription);
            chatSubscription = null;
            showToast('Chat desconectado.');
        }
    }
};