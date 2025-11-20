// =========================================================
// == 1. CONFIGURACIÓN CRÍTICA (SUPABASE ÚNICAMENTE)      ==
// =========================================================

// NOTA: Asegúrate de que tus claves REALES están aquí
const SUPABASE_URL = 'https://ciysaobejtxfkpmbmswb.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_ZVQXNGvJjurUNtqZNQrnPg_aw_wW9gY'; 

// --- NOMBRES DE TABLAS (DEBEN COINCIDIR CON EL SQL) ---
const TABLE_NAMES = {
    'user': 'users',
    'product': 'products',
    'order': 'orders',
    'review': 'reviews',
    'activity': 'activities',
    'config': 'config',
    'message': 'messages'
};

// --- CLAVES GLOBALES (NECESARIAS PARA app.js) ---
DB_KEY = 'mu_marketplace_db_v22_final'; 
SESSION_KEY = 'mu_session_user_v22_final'; 

// --- Inicialización de Cliente ---
let supabase = null;
let chatSubscription = null;

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

window.mockDb = {
    data: [], 
    handler: null,
    notify() {} 
};

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
// == 3. SDK DE DATOS (SUPABASE CRUD con Mapeo a UUID)    ==
// =========================================================
window.dataSdk = {
    
    init: async (handler) => {
        window.mockDb.handler = handler;
        return window.dataSdk.readAllTables();
    },

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
            // Mapeamos 'id' a '__backendId' para compatibilidad con el frontend
            const [users, products, orders, reviews, activities, config] = await Promise.all([
                supabase.from(TABLE_NAMES.user).select('*, __backendId:id'),
                // Seleccionamos el seller_id (UUID)
                supabase.from(TABLE_NAMES.product).select('*, __backendId:id, seller_id'), 
                // Seleccionamos buyer_id y seller_id (UUIDs)
                supabase.from(TABLE_NAMES.order).select('*, __backendId:id, buyer_id, seller_id'),
                // Seleccionamos reviewed_seller_id (UUID)
                supabase.from(TABLE_NAMES.review).select('*, __backendId:id, reviewed_seller_id'), 
                // Seleccionamos user_id (UUID) y username
                supabase.from(TABLE_NAMES.activity).select('*, __backendId:id, user_id, username'), 
                supabase.from(TABLE_NAMES.config).select('config, id').limit(1).single() 
            ]);

            if (users.error || products.error || orders.error || activities.error || reviews.error) {
                console.error("Error leyendo tablas:", users.error || products.error || orders.error || activities.error || reviews.error);
                showToast('❌ Error de lectura de datos. Revise políticas RLS.');
                return { isOk: false };
            }

            // Normalizar y combinar los datos
            const combinedData = [
                // USERS: usa su ID nativo
                ...(users.data || []).map(u => ({ ...u, type: 'user', __backendId: u.id })), 
                
                // PRODUCTS: Mapeo seller_id -> seller (para que la UI pueda usar .seller)
                ...(products.data || []).map(p => ({ 
                    ...p, 
                    type: 'product', 
                    __backendId: p.id, 
                    seller: p.seller_id // Mapeo UUID
                })),
                
                // ORDERS: Mapeo buyer_id/seller_id -> buyer/seller (para que la UI pueda usarlos)
                ...(orders.data || []).map(o => ({ 
                    ...o, 
                    type: 'order', 
                    __backendId: o.id, 
                    buyer: o.buyer_id, // Mapeo UUID
                    seller: o.seller_id // Mapeo UUID
                })), 
                
                // REVIEWS: Mapeo reviewed_seller_id -> reviewed_seller
                ...(reviews.data || []).map(r => ({ 
                    ...r, 
                    type: 'review', 
                    __backendId: r.id, 
                    reviewed_seller: r.reviewed_seller_id // Mapeo UUID
                })),
                
                // ACTIVITIES: Mapeo user_id -> user
                ...(activities.data || []).map(a => ({ 
                    ...a, 
                    type: 'activity', 
                    __backendId: a.id, 
                    user: a.user_id // Mapeo UUID
                })), 
            ];

            // Añadir configuración (si existe)
            if (config.data && config.data.config) {
                 combinedData.push({ type: 'config', ...config.data, __backendId: config.data.id });
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
    
    // Función centralizada de escritura (CREATE/INSERT)
    create: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        // Mapeo inverso de la UI a la BD para INSERT: 
        let insertData = { ...item };

        if (item.type === 'product' && item.seller) {
            insertData.seller_id = item.seller; // seller (UUID) -> seller_id
        } else if (item.type === 'order' && item.buyer && item.seller) {
            insertData.buyer_id = item.buyer;   // buyer (UUID) -> buyer_id
            insertData.seller_id = item.seller; // seller (UUID) -> seller_id
        } else if (item.type === 'review' && item.reviewed_seller) {
             insertData.reviewed_seller_id = item.reviewed_seller; // seller (UUID) -> reviewed_seller_id
        } 
        
        // CORRECCIÓN CLAVE PARA ACTIVITIES: El campo 'user' se mapea a 'user_id'
        if (item.type === 'activity' && item.user) {
             insertData.user_id = item.user; 
        }

        // Limpiar claves de mapeo y auxiliares (type, __backendId, etc.) antes de insertar
        const { __backendId, type, seller, buyer, user, id, ...finalInsertData } = insertData; 
        
        const { data, error } = await supabase
            .from(tableName)
            .insert([finalInsertData])
            .select();

        if (error) {
            console.error(`Error CREATE en tabla ${tableName}:`, error);
            showToast(`❌ Error al crear registro en ${tableName}. (RLS de INSERT?)`);
            return { isOk: false };
        }
        
        await window.dataSdk.readAllTables();
        return { isOk: true, item: { ...data[0], type: item.type, __backendId: data[0].id } };
    },

    // Función centralizada de actualización (UPDATE)
    update: async (item) => {
        if (!supabase) return { isOk: false };
        const tableName = window.dataSdk.getTableFromItem(item);
        
        // Mapeo inverso de la UI a la BD para UPDATE
        let updateData = { ...item };
        
        if (item.type === 'product' && item.seller) {
            updateData.seller_id = item.seller;
        } else if (item.type === 'order' && item.buyer && item.seller) {
            updateData.buyer_id = item.buyer;
            updateData.seller_id = item.seller;
        } else if (item.type === 'review' && item.reviewed_seller) {
             updateData.reviewed_seller_id = item.reviewed_seller;
        } 
        
        // CORRECCIÓN CLAVE PARA ACTIVITIES: El campo 'user' se mapea a 'user_id'
        if (item.type === 'activity' && item.user) {
             updateData.user_id = item.user;
        }


        // Quitamos claves de mapeo, auxiliares y la ID nativa (ya que la usamos en .eq)
        const { __backendId, type, seller, buyer, user, id, ...finalUpdateData } = updateData;

        // Filtramos por la ID nativa de Supabase (item.id o item.__backendId)
        const { data, error } = await supabase
            .from(tableName)
            .update(finalUpdateData)
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
// == 4. SDK DE CHAT (SUPABASE REALTIME)                  ==
// =========================================================
window.chatSdk = {
    
    CHAT_TABLE_NAME: 'messages',

    getMessages: async (orderId) => {
        if (!supabase) return [];
        
        const { data, error } = await supabase
            .from(TABLE_NAMES.message) 
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
            .from(TABLE_NAMES.message) 
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
                    table: TABLE_NAMES.message, 
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
