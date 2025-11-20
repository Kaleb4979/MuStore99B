// =========================================================
// == 1. CONFIGURACIÓN CRÍTICA (SUPABASE ÚNICAMENTE)      ==
// =========================================================

// --- Supabase Config ---
// ⚠️ TUS CLAVES REALES (CONFIRMADAS EN EL PASO ANTERIOR)
const SUPABASE_URL = 'https://ciysaobejtxfkpmbmswb.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_ZVQXNGvJjurUNtqZNQrnPg_aw_wW9gY'; 

// --- NOMBRES DE TABLAS (DEBEN COINCIDIR CON EL SQL) ---
const TABLE_NAMES = {
    users: 'users',
    products: 'products',
    orders: 'orders',
    reviews: 'reviews',
    activities: 'activities',
    config: 'config'
};

const DB_KEY = 'mu_marketplace_db_v22_final'; // Mantenemos la llave para compatibilidad local
const SESSION_KEY = 'mu_session_user_v22_final'; // También para compatibilidad

// --- Inicialización de Cliente ---
let supabase = null;
let chatSubscription = null;

// Función placeholder para showToast (se define en app.js)
function showToast(message) {
    if (window.app && window.app.showToast) {
        window.app.showToast(message);
    } else {
        console.log("TOAST:", message);
    }
}

if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("✅ Cliente Supabase inicializado y listo para usar el Backend.");
} else {
    console.error("❌ Cliente Supabase no inicializado. Verifique las claves y el CDN.");
}


// =========================================================
// == 2. ESTADO BASE y SDKs GLOBALES (MOCKDb ELIMINADO)   ==
// =========================================================

// Usaremos esta estructura de mockDb para mantener compatibilidad con app.js
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
// == 3. SDK DE DATOS (SUPABASE CRUD) - REESCRITO         ==
// =========================================================
window.dataSdk = {
    
    // Función de inicialización y lectura principal
    init: async (handler) => {
        window.mockDb.handler = handler;
        return window.dataSdk.readAllTables();
    },

    // LEE TODAS LAS TABLAS Y COMBINA LOS DATOS EN UN SOLO ARRAY (Reemplaza dataSdk.read de JSONBin)
    readAllTables: async () => {
        if (!supabase) return { isOk: false };
        
        try {
            const [users, products, orders, reviews, activities, config] = await Promise.all([
                supabase.from(TABLE_NAMES.users).select('*'),
                supabase.from(TABLE_NAMES.products).select('*, __backendId:id'), // Mapeamos ID a __backendId
                supabase.from(TABLE_NAMES.orders).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.reviews).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.activities).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.config).select('*').limit(1).single() // Solo leemos 1 config
            ]);

            // Manejo de errores
            if (users.error || products.error || orders.error || reviews.error || activities.error) {
                console.error("Error leyendo tablas:", users.error || products.error || orders.error);
                showToast('❌ Error al cargar datos iniciales de Supabase.');
                return { isOk: false };
            }

            // Normalizar y combinar los datos para que app.js no necesite cambios
            const combinedData = [
                ...(users.data || []).map(u => ({ ...u, type: 'user', __backendId: u.id })),
                ...(products.data || []).map(p => ({ ...p, type: 'product', __backendId: p.id })),
                ...(orders.data || []).map(o => ({ ...o, type: 'order', __backendId: o.id })),
                ...(reviews.data || []).map(r => ({ ...r, type: 'review', __backendId: r.id })),
                ...(activities.data || []).map(a => ({ ...a, type: 'activity', __backendId: a.id })),
            ];

            // Añadir configuración
            if (config.data) {
                 combinedData.push({ type: 'config', ...config.data });
            }
            
            window.mockDb.data = combinedData;
            window.mockDb.handler.onDataChanged(combinedData); 
            return { isOk: true };
            
        } catch (error) {
            console.error("Error fatal en readAllTables:", error);
            showToast('❌ Fallo de conexión inicial con Supabase.');
            return { isOk: false };
        }
    },
    
    // --- Lógica de CRUD: Mapeo de __backendId a ID de Supabase ---

    getTableFromItem: (item) => {
        if (!item.type) throw new Error("Item sin propiedad 'type' para identificar la tabla.");
        const tableName = TABLE_NAMES[item.type];
        if (!tableName) throw new Error(`Tabla desconocida para el tipo: ${item.type}`);
        return tableName;
    },

    // CREATE (Se mapea a INSERT)
    create: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        // El ID lo genera Supabase, pero quitamos __backendId y type para la inserción
        const { __backendId, type, ...insertData } = item;
        
        const { data, error } = await supabase
            .from(tableName)
            .insert([insertData])
            .select();

        if (error) {
            console.error(`Error CREATE en tabla ${tableName}:`, error);
            showToast('❌ Error al crear registro en Supabase.');
            return { isOk: false };
        }
        
        // Forzamos un re-lectura total para refrescar el estado global de app.js
        await window.dataSdk.readAllTables();
        return { isOk: true, item: { ...data[0], type: item.type, __backendId: data[0].id } };
    },

    // UPDATE (Se mapea a UPDATE con filtro por ID)
    update: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        // Quitamos __backendId, type y id para el objeto de actualización
        const { __backendId, type, id, ...updateData } = item;
        
        const { data, error } = await supabase
            .from(tableName)
            .update(updateData)
            .eq('id', item.id || item.__backendId) // Usa ID nativo
            .select(); 

        if (error) {
            console.error(`Error UPDATE en tabla ${tableName}:`, error);
            showToast('❌ Error al actualizar registro en Supabase.');
            return { isOk: false };
        }

        await window.dataSdk.readAllTables();
        return { isOk: true, item: { ...data[0], type: item.type, __backendId: data[0].id } };
    },

    // DELETE (Se mapea a DELETE con filtro por ID)
    delete: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        const { error } = await supabase
            .from(tableName)
            .delete()
            .eq('id', item.id || item.__backendId);

        if (error) {
            console.error(`Error DELETE en tabla ${tableName}:`, error);
            showToast('❌ Error al eliminar registro en Supabase.');
            return { isOk: false };
        }
        
        await window.dataSdk.readAllTables();
        return { isOk: true };
    },
    
    // La función 'write' ya no es necesaria, el CRUD usa CREATE/UPDATE/DELETE.
    write: () => {
        console.warn("dataSdk.write está obsoleto. Use dataSdk.create o dataSdk.update.");
        return { isOk: false };
    }
};


// =========================================================
// == 4. SDK DE CHAT (SUPABASE REALTIME) - MODIFICADO      ==
// =========================================================
window.chatSdk = {
    // ... (El código de chatSdk se mantiene casi igual, usando 'messages' y el cliente Supabase)
    
    // La tabla de mensajes ahora es 'messages'
    CHAT_TABLE_NAME: 'messages',

    // Función central para obtener mensajes del historial
    getMessages: async (orderId) => {
        if (!supabase) return [];
        
        const { data, error } = await supabase
            .from('messages') // Usa la tabla 'messages'
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
            .from('messages') // Usa la tabla 'messages'
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
        
        let initialMessages = await window.chatSdk.getMessages(orderId);
        
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

        chatSubscription = supabase
            .channel(`chat-order-${orderId}`) 
            .on(
                'postgres_changes',
                { 
                    event: 'INSERT', 
                    schema: 'public', 
                    table: 'messages', 
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
