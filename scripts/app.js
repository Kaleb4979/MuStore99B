// =========================================================
// == 1. CONFIGURACIÓN Y ESTADO GLOBAL (Variables de App) ==
// =========================================================

const defaultConfig = {
    site_title: "Mu Online 99B Marketplace",
    contact_info: "Contacto: Discord/WhatsApp",
    background_color: "#0f172a", // Slate-900
    card_background: "#1e293b", // Slate-800
    text_color: "#f1f5f9", // Slate-100
    primary_button: "#3b82f6", // Blue-500
    secondary_button: "#10b981", // Emerald-500
    font_family: "Inter",
    font_size: 16,
    header_logo: "Marketplace Logo",
    footer_text: "© 2024 Mu Online Marketplace. Todos los derechos reservados."
};

let inactivityTimeout;
const TIMEOUT_LIMIT = 5 * 60 * 1000; // 5 minutos

// Estado Global
let currentUser = null;
let currentView = 'catalog'; 
let selectedCategory = 'all';
let selectedShopFilter = null; // Ahora debe ser un UUID si se usa para filtrar productos
let adminViewTarget = null;
let selectedProductToEdit = null;
let managedUser = null;

// Arrays de datos
let allProducts = [];
let allUsers = [];
let allOrders = [];
let allReviews = [];
let appConfig = null; 

// Carrito
let cart = JSON.parse(localStorage.getItem('mu_cart_v22') || '[]');

// Control de Modales
let showModal = null;
let selectedOrder = null;

// ESTADO DEL CHAT
let chatTargetOrder = null;
let chatMessages = []; 

// Constantes
const CATEGORIES = [
    { id: 'all', name: 'Todos', icon: '🎮' },
    { id: 'promotions', name: 'Promociones', icon: '🔥' },
    { id: 'items', name: 'Items', icon: '⚔️' },
    { id: 'jewels', name: 'Joyas', icon: '💎' },
    { id: 'wings', name: 'Alas', icon: '🦅' },
    { id: 'sets', name: 'Sets', icon: '🛡️' }
];
// NOTA: ADMIN_CREDENTIALS solo es usado para notificar
const ADMIN_CREDENTIALS = {
    username: 'Kaleb',
    password: 'Kaleb.2021',
    discord_tag: 'KalebAdmin#9999'
};
let onlineUsers = new Set();
let userActivityTimeout = null;

// =========================================================
// == 2. HANDLER DE DATOS (Recibe los cambios del dataSdk) ==
// =========================================================
const dataHandler = {
    onDataChanged(data) {
        // Separar los datos por tipo
        allProducts = data.filter(item => item.type === 'product') || [];
        allUsers = data.filter(item => item.type === 'user') || [];
        allOrders = data.filter(item => item.type === 'order') || [];
        allReviews = data.filter(item => item.type === 'review') || [];
        const activityRecords = data.filter(item => item.type === 'activity') || [];
        
        // --- Cargar configuración remota ---
        const configItem = data.find(item => item.type === 'config');
        if (configItem && configItem.config) {
            appConfig = configItem.config;
        } else {
            appConfig = defaultConfig; 
        }
        
        // Lógica de notificaciones y actividad
        if (currentUser) {
             const newOrderAlert = activityRecords.find(a => 
                 a.type === 'activity' && a.message && !a.dismissed && 
                 // MANTENEMOS username para NOTIFICACIONES y UI, NO para RLS
                 (a.username === currentUser.username || currentUser.role === 'admin') 
             );

             if (newOrderAlert) {
                 showToast(`🔔 ${newOrderAlert.message}`);
                 // Marcar como dismiss (ocultado) para que no vuelva a saltar
                 const updatedAlert = {...newOrderAlert, dismissed: true};
                 window.dataSdk.update(updatedAlert); 
             }
        }
        
        // Actualizar la lista de usuarios online (usa username para la UI)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        onlineUsers = new Set(
          activityRecords
             .filter(a => a.type === 'activity' && new Date(a.last_activity).getTime() > fiveMinutesAgo)
             .map(a => a.username)
        );
        
        validateCart(); 
        render(); // Volver a pintar la pantalla
    }
};

// Manejador del Chat Realtime
const chatHandler = {
    onMessageReceived(message) {
        chatMessages.push(message);
        
        // 🔔 Lógica de Notificación de Sonido (usa username)
        if (currentUser && message.sender !== currentUser.username) { 
            playNotificationSound();
            if (navigator.vibrate) navigator.vibrate(200); 
        }
        
        // Renderizar solo el modal si está abierto
        if (showModal === 'chat') {
            const messagesContainer = document.querySelector('.chat-messages');
            if (messagesContainer) {
                renderChatMessages(messagesContainer);
            }
        }
    }
};

// Exponer la función showToast en un objeto global para que dataSdk pueda usarla
window.app = { showToast };


// =========================================================
// == 3. FUNCIONES DE UTILIDAD (Toast, Config, Audio)     ==
// =========================================================
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-6 right-6 px-6 py-3 rounded-lg shadow-lg font-semibold z-50 text-white animate-bounce bg-blue-600';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function getConfig() {
    return appConfig || defaultConfig; 
}

function getCategoryIcon(id) {
    const cat = CATEGORIES.find(c => c.id === id);
    return cat ? cat.icon : '📦';
}

function getTopShops() {
      const resellers = allUsers.filter(u => u.role === 'reseller' && u.approved);
      const shopsStats = resellers.map(seller => {
        const { rating, reviewCount } = getShopRating(seller.id); // Usamos ID para buscar reseñas
        
        // CORREGIDO: Contar ventas por el ID del vendedor (seller.id)
        const sales = allOrders.filter(o => o.seller === seller.id && o.order_status === 'completed').length; 
        
        return { 
            ...seller, 
            salesCount: sales, 
            rating: rating, 
            reviewCount: reviewCount
        }; 
      });
      return shopsStats.filter(s => s.salesCount > 0)
          .sort((a, b) => b.salesCount - a.salesCount).slice(0, 3); 
}

// CORREGIDO: Recibe ID del vendedor (UUID)
function getShopRating(sellerId) { 
    // CORREGIDO: Filtrar por el ID del vendedor (reviewed_seller es el UUID)
    const reviews = allReviews.filter(r => r.reviewed_seller === sellerId); 
    const avg = reviews.length ? (reviews.reduce((a,b)=>a+b.rating,0)/reviews.length).toFixed(1) : 0;
    return { rating: parseFloat(avg), reviewCount: reviews.length };
}

function getStarHtml(rating) {
    const fullStars = Math.floor(rating);
    let html = '';
    for (let i = 0; i < fullStars; i++) {
        html += '⭐';
    }
    return html || (rating > 0 ? 'N/A' : 'Sin calificar'); 
}

// CORREGIDO: Mapeo de ventas por ID de vendedor
function getSellerSalesMap() { 
    const salesMap = {};
    allOrders.forEach(order => {
        if (order.order_status === 'completed' && order.seller) { // order.seller es el UUID
            salesMap[order.seller] = (salesMap[order.seller] || 0) + 1;
        }
    });
    return salesMap;
}

// Lógica para reproducir sonido de notificación
function playNotificationSound() {
    const notificationSound = document.getElementById('notification-sound');
    if (notificationSound) {
        notificationSound.currentTime = 0; 
        notificationSound.play().catch(e => {
            console.warn("El navegador bloqueó la reproducción automática de audio:", e);
        });
    }
}


// =========================================================
// == 4. FUNCIONES DE APLICACIÓN (Login, Cart, CRUD, etc.) ==
// =========================================================

// --- Usuario ---
async function handleLogin(e) {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;

    const user = allUsers.find(u => u.username === username && u.password === password);
    
    if (user) {
        if (user.role === 'banned') { 
            showToast('🚫 Tu cuenta ha sido baneada. Contacta al administrador.');
            return;
        }
        currentUser = user;
        // currentUser.id es el UUID
        localStorage.setItem(SESSION_KEY, JSON.stringify(user)); 
        currentView = user.role === 'admin' ? 'admin' : 'catalog';
        showModal = null;
        showToast(`Bienvenido, ${user.username}!`);
        // CORREGIDO: Llama a la actividad
        updateUserActivity(); 
    } else {
        showToast('❌ Credenciales incorrectas.');
    }
    render();
}

async function handleRegisterBuyer(e) {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    const contact = e.target.contact.value;
    
    if (allUsers.some(u => u.username === username)) {
        showToast('❌ El nombre de usuario ya existe.');
        return;
    }

    const newUser = {
        type: 'user',
        username,
        password,
        contact,
        role: 'buyer',
        approved: true, 
        shop_name: null 
    };

    const { isOk } = await window.dataSdk.create(newUser);

    if (isOk) {
        showToast('✅ Registro de comprador exitoso. Inicia sesión.');
        showModal = 'login';
    } else {
        showToast('❌ Error al registrar.');
    }
    render();
}

async function handleRegisterReseller(e) {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    const contact = e.target.contact.value;
    
    if (allUsers.some(u => u.username === username)) {
        showToast('❌ El nombre de usuario ya existe.');
        return;
    }

    const newUser = {
        type: 'user',
        username,
        password,
        contact,
        role: 'reseller',
        approved: false, // Debe ser aprobado por el admin
        shop_name: null 
    };

    const { isOk } = await window.dataSdk.create(newUser);

    if (isOk) {
        showToast('✅ Solicitud enviada. Espera la aprobación del administrador.');
        // Notificar al admin (Usa el username, no requiere ID)
        window.dataSdk.create({
            type: 'activity',
            username: ADMIN_CREDENTIALS.username,
            message: `⚠️ Nueva solicitud de revendedor de ${username}.`,
            dismissed: false,
            last_activity: new Date().toISOString()
        });
        showModal = 'login';
    } else {
        showToast('❌ Error al registrar solicitud.');
    }
    render();
}

// CORREGIDA: Usa el ID (UUID) del usuario para INSERT/UPDATE en activities
async function updateUserActivity() {
    if (!currentUser) return; 

    // Limpiar timeout anterior
    if (userActivityTimeout) clearTimeout(userActivityTimeout);
    
    // CORRECCIÓN 1: Buscar por user_id (UUID)
    const activityRecord = window.mockDb.data.find(a => 
        a.type === 'activity' && (a.user_id === currentUser.id || a.user_id === currentUser.__backendId) && a.last_activity
    );
    
    const newActivity = {
        type: 'activity',
        // CORRECCIÓN 2: Usar user_id para RLS, y username para la UI
        user_id: currentUser.id || currentUser.__backendId, // UUID requerido para RLS (INSERT/UPDATE)
        username: currentUser.username, // Mantener para la UI
        message: `${currentUser.username} está en línea.`,
        last_activity: new Date().toISOString(),
        dismissed: true 
    };

    if (activityRecord) {
        // Actualizar registro existente (UPDATE)
        await window.dataSdk.update({...activityRecord, last_activity: newActivity.last_activity});
    } else {
        // Crear nuevo registro (INSERT)
        await window.dataSdk.create(newActivity); 
    }

    // Programar la próxima actualización
    userActivityTimeout = setTimeout(updateUserActivity, 3 * 60 * 1000); // Cada 3 minutos
}

function logout(auto = false) { 
    window.chatSdk.unsubscribe();
    
    if (userActivityTimeout) clearTimeout(userActivityTimeout);
    clearTimeout(inactivityTimeout);
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    currentView = 'catalog';
    cart = [];
    localStorage.setItem('mu_cart_v22', '[]');
    selectedShopFilter = null;
    adminViewTarget = null; 
    managedUser = null; 
    showToast(auto ? '💤 Sesión cerrada por inactividad' : 'Sesión cerrada');
    render();
}

async function handleSetupShop(e) {
    e.preventDefault();
    const shopName = e.target.shopName.value;

    if (allUsers.some(u => u.shop_name === shopName)) {
        showToast('❌ Este nombre de tienda ya está en uso.');
        return;
    }

    const updatedUser = { ...currentUser, shop_name: shopName };
    const { isOk, item } = await window.dataSdk.update(updatedUser);

    if (isOk) {
        currentUser = item;
        localStorage.setItem(SESSION_KEY, JSON.stringify(item));
        showToast('✅ Tienda configurada con éxito.');
        showModal = null;
    } else {
        showToast('❌ Error al configurar tienda.');
    }
    render();
}

// --- Productos / Admin ---
// CORREGIDO: adminViewTarget ahora es el UUID del vendedor
function openProductManagement(sellerId) { 
    adminViewTarget = sellerId;
    currentView = 'admin';
    render();
}

// CORREGIDO: Usa currentUser.id (UUID)
async function handleAddProduct(e) {
    e.preventDefault();
    const form = e.target;
    const newProduct = {
        type: 'product',
        seller: currentUser.id, // UUID del vendedor
        name: form.name.value,
        category: form.category.value,
        price: parseFloat(form.price.value),
        stock: parseInt(form.stock.value),
        description: form.description.value,
        image_url: form.image_url.value,
        is_promotion: form.is_promotion.checked,
        available: true 
    };
    
    const { isOk } = await window.dataSdk.create(newProduct);
    if (isOk) {
        showToast('✅ Producto agregado con éxito.');
        form.reset();
    } else {
        showToast('❌ Error al agregar producto.');
    }
}

// ... [El resto de funciones de CRUD (openEditModal, handleUpdateProduct, deleteProduct, etc.) usan __backendId, que es el ID (UUID) nativo y no requieren cambios directos aquí] ...

// --- Carrito / Pedidos ---

// CORREGIDO: Usa el seller (UUID) para agrupar
async function createOrder() {
    if (cart.length === 0) {
        showToast('❌ El carrito está vacío.');
        return;
    }
    
    // Agrupar por seller (UUID)
    const ordersBySeller = cart.reduce((acc, item) => {
        (acc[item.seller] = acc[item.seller] || []).push(item);
        return acc;
    }, {});
    
    showToast('⏳ Creando órdenes...');

    for (const sellerId in ordersBySeller) { // sellerId es el UUID
        const items = ordersBySeller[sellerId];
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        
        // Obtener nombres de usuario para UI/Notificaciones
        const buyerUser = allUsers.find(u => u.id === currentUser.id);
        const sellerUser = allUsers.find(u => u.id === sellerId);
        
        const newOrder = {
            type: 'order',
            // CORREGIDO: Usar UUIDs
            buyer: currentUser.id,      // UUID del comprador
            seller: sellerId,           // UUID del vendedor
            
            // Usar usernames si la columna aún existe para UI/Notificaciones
            buyer_username: buyerUser.username,
            seller_username: sellerUser.username, 

            items: items,
            total_price: total,
            order_status: 'pending', 
            created_at: new Date().toISOString()
        };
        
        const { isOk } = await window.dataSdk.create(newOrder);

        if (isOk) {
            // Notificar al vendedor (usa username para la UI)
            window.dataSdk.create({
                type: 'activity',
                username: sellerUser.username,
                message: `🛒 ¡Nueva orden de ${currentUser.username} por ${total} Zen!`,
                dismissed: false,
                last_activity: new Date().toISOString()
            });
            
            // Reducir el stock de los productos
            for (const cartItem of items) {
                const product = allProducts.find(p => p.__backendId === cartItem.backendId);
                if (product) {
                    const updatedProduct = {...product, stock: product.stock - cartItem.quantity};
                    await window.dataSdk.update(updatedProduct);
                }
            }
        }
    }
    
    cart = [];
    updateCartStorage();
    currentView = 'orders';
    showToast('✅ Órdenes creadas con éxito. Revisa el historial.');
    render();
}

// ... [El resto de funciones se mantiene igual] ...

// --- Inicialización ---
async function init() {
    const storedUser = localStorage.getItem(SESSION_KEY);
    if (storedUser) {
      currentUser = JSON.parse(storedUser);
      showToast(`👋 Sesión restaurada: ${currentUser.username}`);
    }

    setupAutoLogout();

    // Iniciar SDK de Datos (lee de Supabase y notifica a dataHandler)
    const { isOk } = await window.dataSdk.init(dataHandler);

    if (currentUser) {
        const userCheck = allUsers.find(u => u.username === currentUser.username);
        if (userCheck && userCheck.role === 'banned') {
            logout(); 
            showToast('🚫 Sesión cerrada: tu cuenta fue baneada.');
            return; 
        }
        
        // Solo llamar si la lectura de datos fue OK (si no, fallará de nuevo)
        if(isOk) {
            updateUserActivity();
        } else {
            // Si hay error en la lectura, no puede actualizar la actividad
            console.warn("No se pudo actualizar la actividad del usuario debido a un fallo en la lectura inicial.");
        }
    }
    render();
}

function setupAutoLogout() {
    const events = ['mousemove', 'keypress', 'click', 'scroll'];
    events.forEach(event => document.addEventListener(event, resetTimer));
    resetTimer();
}

function resetTimer() {
    if (currentUser) {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(() => logout(true), TIMEOUT_LIMIT);
    }
}

// =========================================================
// == 6. INICIO DE LA APLICACIÓN                          ==
// =========================================================
init();
