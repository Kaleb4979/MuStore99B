// =========================================================
// == 1. CONFIGURACIÓN CRÍTICA (SUPABASE ÚNICAMENTE)      ==
// =========================================================

// --- Supabase Config ---
// ⚠️ TUS CLAVES REALES (CONFIRMADAS)
const SUPABASE_URL = 'https://ciysaobejtxfkpmbmswb.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_ZVQXNGvJjurUNtqZNQrnPg_aw_wW9gY'; 

// --- NOMBRES DE TABLAS (DEBEN COINCIDIR CON EL SQL) ---
// CLAVE: Tipo de dato en el JSON. VALOR: Nombre de la tabla en Supabase.
const TABLE_NAMES = {
    'user': 'users',
    'product': 'products',
    'order': 'orders',
    'review': 'reviews',
    'activity': 'activities',
    'config': 'config'
};

const DB_KEY = 'mu_marketplace_db_v22_final'; 
const SESSION_KEY = 'mu_session_user_v22_final'; 

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
// == 2. ESTADO BASE y SDKs GLOBALES                      ==
// =========================================================

// Usamos esta estructura de mockDb para mantener compatibilidad con app.js
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
    
    init: async (handler) => {
        window.mockDb.handler = handler;
        return window.dataSdk.readAllTables();
    },

    // Función auxiliar para obtener el nombre de la tabla
    getTableFromItem: (item) => {
        const typeKey = item.type;
        const tableName = TABLE_NAMES[typeKey];
        if (!tableName) {
             throw new Error(`Tabla desconocida para el tipo: ${typeKey}`);
        }
        return tableName;
    },

    // LEE TODAS LAS TABLAS Y COMBINA LOS DATOS EN UN SOLO ARRAY
    readAllTables: async () => {
        if (!supabase) return { isOk: false };
        
        try {
            // Lee todas las tablas en paralelo
            const [users, products, orders, reviews, activities, config] = await Promise.all([
                supabase.from(TABLE_NAMES.user).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.product).select('*, __backendId:id'), 
                supabase.from(TABLE_NAMES.order).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.review).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.activity).select('*, __backendId:id'),
                supabase.from(TABLE_NAMES.config).select('config, id').limit(1).single() // Solo necesitamos la configuración
            ]);

            // Manejo de errores de lectura
            if (users.error && users.error.code !== '406') { // El 406 lo manejamos con el toast RLS
                console.error("Error leyendo tablas:", users.error || products.error);
                showToast('❌ Error al cargar datos iniciales. Revise políticas RLS.');
                return { isOk: false };
            }

            // Normalizar y combinar los datos
            const combinedData = [
                ...(users.data || []).map(u => ({ ...u, type: 'user', __backendId: u.id })),
                ...(products.data || []).map(p => ({ ...p, type: 'product', __backendId: p.id })),
                ...(orders.data || []).map(o => ({ ...o, type: 'order', __backendId: o.id })),
                ...(reviews.data || []).map(r => ({ ...r, type: 'review', __backendId: r.id })),
                ...(activities.data || []).map(a => ({ ...a, type: 'activity', __backendId: a.id })),
            ];

            // Añadir configuración (si existe)
            if (config.data && config.data.config) {
                 combinedData.push({ type: 'config', ...config.data, __backendId: config.data.id });
            }
            
            window.mockDb.data = combinedData;
            window.mockDb.handler.onDataChanged(combinedData); 
            
            // Si hubo error 406 en config, mostramos el toast después de cargar
            if (config.error && config.error.code === '406') {
                showToast('❌ RLS en tabla CONFIG. Asegure SELECT para anon.');
            }
            
            return { isOk: true };
            
        } catch (error) {
            console.error("Error fatal en readAllTables:", error);
            showToast('❌ Fallo de conexión inicial con Supabase.');
            return { isOk: false };
        }
    },
    
    // CREATE (Se mapea a INSERT)
    create: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        // El ID lo genera Supabase, eliminamos __backendId y type para la inserción
        const { __backendId, type, id, ...insertData } = item;
        
        const { data, error } = await supabase
            .from(tableName)
            .insert([insertData])
            .select();

        if (error) {
            console.error(`Error CREATE en tabla ${tableName}:`, error);
            showToast(`❌ Error al crear registro en ${tableName}. (RLS de INSERT?)`);
            return { isOk: false };
        }
        
        // Forzamos un re-lectura total para refrescar el estado global
        await window.dataSdk.readAllTables();
        return { isOk: true, item: { ...data[0], type: item.type, __backendId: data[0].id } };
    },

    // UPDATE (Se mapea a UPDATE con filtro por ID)
    update: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        // Quitamos __backendId, type y id para el objeto de actualización
        const { __backendId, type, id, ...updateData } = item;
        
        // Usamos la ID original de Supabase (item.id) o la backendId para el filtro
        const { data, error } = await supabase
            .from(tableName)
            .update(updateData)
            .eq('id', item.id || item.__backendId) 
            .select(); 

        if (error) {
            console.error(`Error UPDATE en tabla ${tableName}:`, error);
            showToast(`❌ Error al actualizar registro en ${tableName}. (RLS de UPDATE?)`);
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
            showToast(`❌ Error al eliminar registro en ${tableName}. (RLS de DELETE?)`);
            return { isOk: false };
        }
        
        await window.dataSdk.readAllTables();
        return { isOk: true };
    },
    
    write: () => {
        console.warn("dataSdk.write está obsoleto. Use dataSdk.create o dataSdk.update.");
        return { isOk: false };
    }
};


// =========================================================
// == 4. SDK DE CHAT (SUPABASE REALTIME) - SIN CAMBIOS     ==
// =========================================================
window.chatSdk = {
    
    CHAT_TABLE_NAME: 'messages',

    getMessages: async (orderId) => {
        if (!supabase) return [];
        
        const { data, error } = await supabase
            .from('messages') 
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

    sendMessage: async (orderId, sender, content) => {
        if (!supabase || !content.trim()) return;
        
        const { error } = await supabase
            .from('messages') 
            .insert([{ order_id: orderId, sender: sender, content: content }]);
            
        if (error) {
            console.error('Error al enviar mensaje a Supabase:', error);
            showToast('❌ Error al enviar mensaje.');
        }
    },

    handleRealtimeChange: null,

    subscribeToOrder: async (orderId, handler) => {
        if (!supabase) {
            showToast('⚠️ Supabase no configurado. Chat en modo simulado/local.');
            return;
        }
        
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
        return initialMessages;
    },

    unsubscribe: () => {
        if (chatSubscription) {
            supabase.removeChannel(chatSubscription);
            chatSubscription = null;
            showToast('Chat desconectado.');
        }
    }
};
