// =========================================================
// == 1. CONFIGURACIÓN Y ESTADO GLOBAL (Variables de App) ==
// =========================================================

const SESSION_KEY = 'mu_session_user_v22_final'; // Definida originalmente en el HTML

const defaultConfig = {
    site_title: "Mu Online 99B Marketplace",
    contact_info: "Contacto: Discord/WhatsApp",
    background_color: "#0f172a", // Slate-900
    card_background: "#1e293b", // Slate-800
    text_color: "#f1f5f9", // Slate-100
    primary_button: "#3b82f6", // Blue-500
    secondary_button: "#10b981", // Emerald-500
    font_family: "Inter",
    font_size: 16
};

// Variables de Timeout para Auto-Logout
let inactivityTimeout;
const TIMEOUT_LIMIT = 5 * 60 * 1000; // 5 minutos

// Estado Global
let currentUser = null;
let currentView = 'catalog'; // 'catalog', 'cart', 'orders', 'admin'
let selectedCategory = 'all';
let selectedShopFilter = null;
let adminViewTarget = null; 
let selectedProductToEdit = null; 
let managedUser = null; 

// Arrays de datos (Poblados por dataSdk.read)
let allProducts = [];
let allUsers = [];
let allOrders = [];
let allReviews = []; 

// Carrito
let cart = JSON.parse(localStorage.getItem('mu_cart_v22') || '[]');

// Control de Modales
let showModal = null; 
let selectedOrder = null; 

// ESTADO DEL CHAT
let chatTargetOrder = null; 
let chatMessages = []; // Almacena mensajes

// Constantes
const CATEGORIES = [
    { id: 'all', name: 'Todos', icon: '🎮' },
    { id: 'promotions', name: 'Promociones', icon: '🔥' },
    { id: 'items', name: 'Items', icon: '⚔️' },
    { id: 'jewels', name: 'Joyas', icon: '💎' },
    { id: 'wings', name: 'Alas', icon: '🦅' },
    { id: 'sets', name: 'Sets', icon: '🛡️' }
];
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
        
        // Lógica de notificaciones y actividad
        if (currentUser) {
             const newOrderAlert = activityRecords.find(a => 
                a.type === 'activity' && a.message && !a.dismissed && 
                (a.username === currentUser.username || currentUser.role === 'admin') 
            );

            if (newOrderAlert) {
                showToast(`🔔 ${newOrderAlert.message}`);
                const updatedAlert = {...newOrderAlert, dismissed: true};
                window.dataSdk.update(updatedAlert); 
            }
        }
        
        // Actualizar la lista de usuarios online
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
        // Añadir el mensaje nuevo
        chatMessages.push(message);
        
        // 🔔 Lógica de Notificación de Sonido
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
// == 3. FUNCIONES DE UTILIDAD (Toast, Config, Audio)      ==
// =========================================================
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-6 right-6 px-6 py-3 rounded-lg shadow-lg font-semibold z-50 text-white animate-bounce bg-blue-600';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function getConfig() {
    const configItem = window.mockDb.data.find(item => item.type === 'config');
    if (configItem) return configItem.config;
    return window.elementSdk ? window.elementSdk.config : defaultConfig;
}

function getCategoryIcon(id) {
    const cat = CATEGORIES.find(c => c.id === id);
    return cat ? cat.icon : '📦';
}

function getTopShops() {
      const resellers = allUsers.filter(u => u.role === 'reseller' && u.approved);
      const shopsStats = resellers.map(seller => {
        const { rating, reviewCount } = getShopRating(seller.username);
        const sales = allOrders.filter(o => o.seller_username === seller.username && o.order_status === 'completed').length;
        
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

function getShopRating(username) {
    const reviews = allReviews.filter(r => r.reviewed_seller === username);
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

function getSellerSalesMap() {
    const salesMap = {};
    allOrders.forEach(order => {
        if (order.order_status === 'completed' && order.seller_username) {
            salesMap[order.seller_username] = (salesMap[order.seller_username] || 0) + 1;
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
        currentUser = user;
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
        currentView = user.role === 'admin' ? 'admin' : 'catalog';
        showModal = null;
        showToast(`Bienvenido, ${user.username}!`);
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

    const { isOk, item } = await window.dataSdk.create(newUser);

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

    const { isOk, item } = await window.dataSdk.create(newUser);

    if (isOk) {
        showToast('✅ Solicitud enviada. Espera la aprobación del administrador.');
        // Notificar al admin
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

async function updateUserActivity() {
    if (!currentUser || currentUser.role === 'admin') return; 

    // Limpiar timeout anterior
    if (userActivityTimeout) clearTimeout(userActivityTimeout);
    
    const activityRecord = window.mockDb.data.find(a => 
        a.type === 'activity' && a.username === currentUser.username && a.last_activity
    );
    
    const newActivity = {
        type: 'activity',
        username: currentUser.username,
        message: `${currentUser.username} está en línea.`,
        last_activity: new Date().toISOString(),
        dismissed: true // No es un mensaje de alerta, solo actividad
    };

    if (activityRecord) {
        // Actualizar registro existente
        await window.dataSdk.update({...activityRecord, last_activity: newActivity.last_activity});
    } else {
        // Crear nuevo registro
        await window.dataSdk.create(newActivity);
    }

    // Programar la próxima actualización
    userActivityTimeout = setTimeout(updateUserActivity, 3 * 60 * 1000); // Cada 3 minutos
}

function logout(auto = false) { 
    // AGREGAR UNSUBSCRIBE EN LOGOUT
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
function openProductManagement(username) {
    adminViewTarget = username;
    currentView = 'admin';
    render();
}

async function handleAddProduct(e) {
    e.preventDefault();
    const form = e.target;
    const newProduct = {
        type: 'product',
        seller: currentUser.username,
        name: form.name.value,
        category: form.category.value,
        price: parseFloat(form.price.value),
        stock: parseInt(form.stock.value),
        description: form.description.value,
        image_url: form.image_url.value,
        is_promotion: form.is_promotion.checked,
        available: true,
        created_at: new Date().toISOString()
    };
    
    const { isOk } = await window.dataSdk.create(newProduct);
    if (isOk) {
        showToast('✅ Producto agregado con éxito.');
        form.reset();
    } else {
        showToast('❌ Error al agregar producto.');
    }
}

function openEditModal(backendId) {
    selectedProductToEdit = allProducts.find(p => p.__backendId === backendId);
    if (selectedProductToEdit) {
        showModal = 'editProduct';
    }
    render();
}

async function handleUpdateProduct(e) {
    e.preventDefault();
    const form = e.target;
    const updatedProduct = {
        ...selectedProductToEdit,
        name: form.name.value,
        category: form.category.value,
        price: parseFloat(form.price.value),
        stock: parseInt(form.stock.value),
        description: form.description.value,
        image_url: form.image_url.value,
        is_promotion: form.is_promotion.checked,
        available: form.available.checked
    };
    
    const { isOk } = await window.dataSdk.update(updatedProduct);
    if (isOk) {
        showToast('✅ Producto actualizado con éxito.');
        showModal = null;
        selectedProductToEdit = null;
    } else {
        showToast('❌ Error al actualizar producto.');
    }
    render();
}

async function deleteProduct(backendId) {
    if (!confirm('¿Estás seguro de que quieres eliminar este producto?')) return;
    const productToDelete = allProducts.find(p => p.__backendId === backendId);
    const { isOk } = await window.dataSdk.delete(productToDelete);
    if (isOk) {
        showToast('🗑️ Producto eliminado.');
    } else {
        showToast('❌ Error al eliminar producto.');
    }
    render();
}

function openManageUserModal(username) {
    managedUser = allUsers.find(u => u.username === username);
    if (managedUser) {
        showModal = 'manageUser';
    }
    render();
}

async function clearCompletedOrdersLog() {
    if (!confirm('¿Estás seguro de que quieres ELIMINAR permanentemente todas las órdenes completadas?')) return;
    const ordersToKeep = allOrders.filter(o => o.order_status !== 'completed');
    const ordersToDelete = allOrders.filter(o => o.order_status === 'completed');

    if (ordersToDelete.length === 0) {
        showToast('No hay órdenes completadas para eliminar.');
        return;
    }

    const newData = window.mockDb.data.filter(item => 
        item.type !== 'order' || item.order_status !== 'completed'
    );
    
    const result = await window.dataSdk.write(newData);

    if (result.isOk) {
        showToast(`✅ ${ordersToDelete.length} órdenes completadas eliminadas del log.`);
    } else {
        showToast('❌ Error al limpiar el log.');
    }
}

async function approveUser(backendId) {
    const userToUpdate = allUsers.find(u => u.__backendId === backendId);
    if (!userToUpdate) return;
    
    const updatedUser = { ...userToUpdate, approved: true };
    const { isOk, item } = await window.dataSdk.update(updatedUser);
    
    if (isOk) {
        showToast(`✅ Revendedor ${item.username} aprobado.`);
        showModal = null;
    } else {
        showToast('❌ Error al aprobar usuario.');
    }
    render();
}

async function rejectUser(backendId) {
    if (!confirm('¿Estás seguro de que quieres rechazar esta solicitud?')) return;
    const userToReject = allUsers.find(u => u.__backendId === backendId);
    const { isOk } = await window.dataSdk.delete(userToReject);
    
    if (isOk) {
        showToast(`🗑️ Solicitud de ${userToReject.username} rechazada y eliminada.`);
        showModal = null;
    } else {
        showToast('❌ Error al rechazar usuario.');
    }
    render();
}

async function banUser(backendId) {
    if (!confirm('¿Estás seguro de que quieres BANEAR a este usuario?')) return;
    const userToBan = allUsers.find(u => u.__backendId === backendId);
    if (!userToBan) return;
    
    const updatedUser = { ...userToBan, role: 'banned', approved: false };
    const { isOk, item } = await window.dataSdk.update(updatedUser);
    
    if (isOk) {
        showToast(`🚫 Usuario ${item.username} ha sido BANEADO.`);
        showModal = null;
    } else {
        showToast('❌ Error al banear usuario.');
    }
    render();
}

async function deleteUserAccount(backendId) {
    if (!confirm('⚠️ ESTA ACCIÓN ES PERMANENTE. ¿Deseas eliminar completamente la cuenta?')) return;
    const userToDelete = allUsers.find(u => u.__backendId === backendId);
    const { isOk } = await window.dataSdk.delete(userToDelete);
    
    if (isOk) {
        showToast(`🗑️ Cuenta de ${userToDelete.username} eliminada permanentemente.`);
        showModal = null;
    } else {
        showToast('❌ Error al eliminar cuenta.');
    }
    render();
}

function enterShopManagement(targetUsername) {
    selectedShopFilter = targetUsername;
    currentView = 'catalog';
    showToast(`🛒 Filtrando por tienda: ${targetUsername}`);
    render();
}

function exitShopManagement() {
    selectedShopFilter = null;
    currentView = 'catalog';
    showToast('Filtro de tienda eliminado.');
    render();
}

async function loadAdminView() {
    adminViewTarget = null;
    currentView = 'admin';
    render();
}

// --- Carrito / Pedidos ---
function updateCartStorage() {
    localStorage.setItem('mu_cart_v22', JSON.stringify(cart));
}

function validateCart() {
    cart = cart.filter(cartItem => {
        const product = allProducts.find(p => p.__backendId === cartItem.backendId);
        // El producto existe y el stock es suficiente
        return product && product.available && product.stock >= cartItem.quantity;
    });
    updateCartStorage();
}

function addToCart(backendId) {
    if (!currentUser || currentUser.role !== 'buyer') {
        showToast('❌ Debes iniciar sesión como Comprador.');
        return;
    }
    const product = allProducts.find(p => p.__backendId === backendId);
    if (!product || product.stock < 1) {
        showToast('❌ Producto agotado o no disponible.');
        return;
    }

    const existingItem = cart.find(item => item.backendId === backendId);

    if (existingItem) {
        if (existingItem.quantity < product.stock) {
            existingItem.quantity += 1;
            showToast(`⬆️ +1 ${product.name} añadido al carrito.`);
        } else {
            showToast(`❌ Stock máximo alcanzado para ${product.name}.`);
        }
    } else {
        cart.push({
            backendId: backendId,
            quantity: 1,
            seller: product.seller,
            price: product.price,
            name: product.name,
        });
        showToast(`🛒 ${product.name} añadido al carrito.`);
    }

    updateCartStorage();
    render();
}

function removeFromCart(index) {
    const item = cart[index];
    if (item.quantity > 1) {
        item.quantity -= 1;
        showToast(`⬇️ -1 ${item.name} en el carrito.`);
    } else {
        cart.splice(index, 1);
        showToast(`🗑️ ${item.name} eliminado del carrito.`);
    }
    updateCartStorage();
    render();
}

function filterByShop(shopName) {
    selectedShopFilter = shopName;
    currentView = 'catalog';
    render();
}

function clearShopFilter() {
    selectedShopFilter = null;
    render();
}

async function createOrder() {
    if (cart.length === 0) {
        showToast('❌ El carrito está vacío.');
        return;
    }
    
    // Agrupar por vendedor para crear múltiples órdenes
    const ordersBySeller = cart.reduce((acc, item) => {
        (acc[item.seller] = acc[item.seller] || []).push(item);
        return acc;
    }, {});
    
    showToast('⏳ Creando órdenes...');

    for (const seller in ordersBySeller) {
        const items = ordersBySeller[seller];
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

        const newOrder = {
            type: 'order',
            buyer_username: currentUser.username,
            seller_username: seller,
            items: items,
            total_price: total,
            order_status: 'pending', // Nuevo estado
            created_at: new Date().toISOString()
        };
        
        const { isOk, item: createdOrder } = await window.dataSdk.create(newOrder);

        if (isOk) {
            // Notificar al vendedor
            window.dataSdk.create({
                type: 'activity',
                username: seller,
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

async function confirmOrder(backendId, isSeller) {
    const order = allOrders.find(o => o.__backendId === backendId);
    if (!order) return;

    let updatedOrder = { ...order };
    let toastMessage = '';
    let notificationUser = '';
    let notificationMessage = '';
    
    if (isSeller) {
        if (order.order_status === 'pending') {
            updatedOrder.order_status = 'confirmed_by_seller';
            toastMessage = '✅ Orden aceptada. El comprador debe confirmar la recepción.';
            notificationUser = order.buyer_username;
            notificationMessage = `🔔 Tu orden ${backendId.slice(-4)} ha sido aceptada por el vendedor.`;
        } else if (order.order_status === 'confirmed_by_buyer') {
             updatedOrder.order_status = 'completed';
             toastMessage = '🎉 Orden completada y registrada.';
             notificationUser = order.buyer_username;
             notificationMessage = `🎉 Tu orden ${backendId.slice(-4)} ha sido marcada como completada.`;
        }
    } else { // Es el comprador
        if (order.order_status === 'confirmed_by_seller') {
            updatedOrder.order_status = 'confirmed_by_buyer';
            toastMessage = '✅ Confirmaste la recepción. Esperando la confirmación final del vendedor.';
            notificationUser = order.seller_username;
            notificationMessage = `✅ El comprador confirmó la recepción de la orden ${backendId.slice(-4)}.`;
        }
    }

    if (updatedOrder.order_status !== order.order_status) {
        const { isOk } = await window.dataSdk.update(updatedOrder);
        if (isOk) {
            showToast(toastMessage);
            if (notificationUser) {
                 window.dataSdk.create({
                    type: 'activity',
                    username: notificationUser,
                    message: notificationMessage,
                    dismissed: false,
                    last_activity: new Date().toISOString()
                });
            }
        } else {
            showToast('❌ Error al actualizar el estado de la orden.');
        }
    }
}

async function handleSubmitReview(e) {
    e.preventDefault();
    const orderId = e.target.orderId.value;
    const rating = parseInt(e.target.rating.value);
    const comment = e.target.comment.value;
    
    const order = allOrders.find(o => o.__backendId === orderId);
    if (!order || order.order_status !== 'completed' || order.reviewed) {
        showToast('❌ Orden no elegible para reseña.');
        return;
    }

    const newReview = {
        type: 'review',
        order_id: orderId,
        reviewer_username: currentUser.username,
        reviewed_seller: order.seller_username,
        rating: rating,
        comment: comment,
        created_at: new Date().toISOString()
    };
    
    const { isOk: reviewOk } = await window.dataSdk.create(newReview);
    
    if (reviewOk) {
        const updatedOrder = {...order, reviewed: true};
        await window.dataSdk.update(updatedOrder);
        showToast('⭐ Reseña enviada con éxito!');
        showModal = null;
    } else {
        showToast('❌ Error al enviar reseña.');
    }
    render();
}


// --- Chat ---
async function openChatModal(orderId) {
    const order = allOrders.find(o => o.__backendId === orderId);
    if (!order) return;
    
    chatTargetOrder = order;
    showModal = 'chat';
    render(); 
    
    // Iniciar la suscripción de chat y obtener mensajes iniciales
    const initialMessages = await window.chatSdk.subscribeToOrder(orderId, chatHandler);
    chatMessages = initialMessages;
    
    // Forzar el renderizado de mensajes iniciales y el scroll
    setTimeout(() => {
         const messagesContainer = document.querySelector('.chat-messages');
         if (messagesContainer) {
             renderChatMessages(messagesContainer);
             messagesContainer.scrollTop = messagesContainer.scrollHeight;
         }
    }, 50);
}

function closeChatModal() {
    window.chatSdk.unsubscribe();
    showModal = null;
    chatTargetOrder = null;
    chatMessages = []; 
    render();
}

function handleChatMessageSend(e) {
    e.preventDefault();
    if (!chatTargetOrder || !currentUser) return;
    
    const input = document.getElementById('chatInput');
    const content = input.value;
    if (!content.trim()) return;
    
    // Usar el SDK real de Supabase
    window.chatSdk.sendMessage(chatTargetOrder.__backendId, currentUser.username, content);
    input.value = ''; 
    
    setTimeout(() => {
          const messagesContainer = document.querySelector('.chat-messages');
          if (messagesContainer) {
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
    }, 50);
}

function renderChatMessages(container) {
    if (!container) return;
        
    const messagesHtml = chatMessages.map(msg => {
        const isSelf = currentUser && msg.sender === currentUser.username;
        const time = new Date(msg.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="flex ${isSelf ? 'justify-end' : 'justify-start'}">
                <div class="message-bubble ${isSelf ? 'message-self' : 'message-other'}">
                    <div class="font-bold text-xs ${isSelf ? '' : 'text-blue-300'} mb-1">${isSelf ? 'Tú' : msg.sender}</div>
                    <div>${msg.content}</div>
                    <div class="text-right text-[10px] opacity-60 mt-1">${time}</div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = messagesHtml;
    // El scroll se maneja en el handler y en handleChatMessageSend
}


// =========================================================
// == 5. RENDERIZADO VISUAL Y FUNCIONES DE INICIO          ==
// =========================================================

function render() {
    const app = document.getElementById('app');
    const config = getConfig();
    document.body.style.backgroundColor = config.background_color;
    document.body.style.color = config.text_color;

    let content = '';
    if (currentView === 'catalog') content = renderCatalog();
    else if (currentView === 'cart') content = renderCart();
    else if (currentView === 'orders') content = renderOrders();
    else if (currentView === 'admin') content = renderAdmin();
    else if (currentView === 'shopManagement') content = renderShopManagement();

    app.innerHTML = content;

    const modalContainer = document.getElementById('modalContainer');
    const modalHTML = showModal ? renderModal() : '';
    
    if (modalContainer) {
        modalContainer.innerHTML = modalHTML;
    } else {
        const d = document.createElement('div'); 
        d.id = 'modalContainer';
        document.body.appendChild(d);
        d.innerHTML = modalHTML;
    }
}


// --- Renderizado de Vistas ---

function renderHeader(config) {
    const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const userButton = currentUser 
        ? `<button onclick="logout()" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition">Logout (${currentUser.username})</button>`
        : `<button onclick="showModal = 'login'; render()" class="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded transition">Login/Registro</button>`;

    const adminButton = (currentUser && currentUser.role === 'admin')
        ? `<button onclick="loadAdminView()" class="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-2 px-4 rounded transition ml-2">Admin</button>`
        : '';

    const cartButton = (currentUser && currentUser.role === 'buyer') 
        ? `<button onclick="currentView = 'cart'; render()" class="relative bg-teal-500 hover:bg-teal-600 text-white font-bold py-2 px-4 rounded transition ml-2">
            🛒 Carrito 
            ${totalCartItems > 0 ? `<span class="cart-badge">${totalCartItems}</span>` : ''}
        </button>`
        : '';
        
    const ordersButton = (currentUser && (currentUser.role === 'buyer' || currentUser.role === 'reseller')) 
        ? `<button onclick="currentView = 'orders'; render()" class="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded transition ml-2">
            📦 Mis Órdenes
        </button>`
        : '';

    return `
        <header class="sticky top-0 z-10 p-4 shadow-xl" style="background-color: ${config.card_background};">
            <div class="max-w-7xl mx-auto flex justify-between items-center">
                <h1 class="text-3xl font-extrabold cursor-pointer" onclick="currentView = 'catalog'; render()" style="color: ${config.primary_button};">
                    ${config.site_title}
                </h1>
                <div class="flex items-center">
                    ${ordersButton}
                    ${cartButton}
                    ${adminButton}
                    ${userButton}
                </div>
            </div>
        </header>
    `;
}

function renderCatalog() {
    const config = getConfig();
    const availableProducts = allProducts.filter(p => p.available && (currentUser && currentUser.role === 'reseller' ? p.seller === currentUser.username : true));
    
    // Aplicar filtro por categoría
    let filteredProducts = selectedCategory === 'all'
        ? availableProducts
        : availableProducts.filter(p => p.category === selectedCategory || (selectedCategory === 'promotions' && p.is_promotion));
        
    // Aplicar filtro por tienda
    if (selectedShopFilter) {
        filteredProducts = filteredProducts.filter(p => p.seller === selectedShopFilter);
    }
        
    const shopsHtml = getTopShops().map((shop, index) => {
        let rankClass = '';
        if (index === 0) rankClass = 'rank-1';
        else if (index === 1) rankClass = 'rank-2';
        else if (index === 2) rankClass = 'rank-3';

        return `
            <div onclick="filterByShop('${shop.username}')" 
                 class="shop-badge flex flex-col items-center justify-center p-3 m-1 rounded-lg border-2 text-sm bg-slate-700 hover:bg-indigo-700 ${rankClass}"
                 style="background-color: ${config.card_background}; border-color: ${rankClass ? '' : config.primary_button};">
                <div class="font-bold text-lg">${index + 1}</div>
                <div class="text-xs">${shop.shop_name || shop.username}</div>
                <div class="text-[10px] text-yellow-400">${getStarHtml(shop.rating)} (${shop.reviewCount})</div>
                <div class="text-xs text-gray-400 mt-1">${shop.salesCount} ventas</div>
                ${onlineUsers.has(shop.username) ? '<span class="live-indicator"></span>' : ''}
            </div>
        `;
    }).join('');

    const categoriesHtml = CATEGORIES.map(cat => `
        <button onclick="selectedCategory = '${cat.id}'; render()" 
            class="category-btn px-4 py-2 mx-1 rounded-full font-semibold transition ${selectedCategory === cat.id ? `bg-blue-600 text-white shadow-lg` : 'bg-slate-700 hover:bg-slate-600'}"
            style="background-color: ${selectedCategory === cat.id ? config.primary_button : config.card_background};">
            ${cat.icon} ${cat.name}
        </button>
    `).join('');

    const productsHtml = filteredProducts.map(p => {
        const shop = allUsers.find(u => u.username === p.seller);
        const shopName = shop ? shop.shop_name || p.seller : p.seller;
        const shopContact = shop ? shop.contact : 'N/A';
        const isReseller = shop && shop.role === 'reseller';

        return `
            <div class="product-card flex flex-col justify-between rounded-xl shadow-2xl p-4 animate-bounce-in" 
                 style="background-color: ${config.card_background};">
                <div>
                    <img src="${p.image_url || 'https://via.placeholder.com/150'}" alt="${p.name}" class="w-full h-32 object-contain rounded-lg mb-3">
                    <h3 class="text-xl font-bold mb-1 truncate">${p.name}</h3>
                    <div class="text-sm font-semibold mb-2">
                        ${getCategoryIcon(p.category)} ${p.category.charAt(0).toUpperCase() + p.category.slice(1)}
                        ${p.is_promotion ? '<span class="ml-2 text-red-400 font-bold">🔥 Promo</span>' : ''}
                    </div>
                    <p class="text-sm text-gray-400 mb-3 line-clamp-3">${p.description}</p>
                </div>
                <div>
                    <div class="flex justify-between items-center mb-3">
                        <div class="text-lg font-extrabold text-green-400">${p.price} Zen</div>
                        <div class="text-xs text-gray-400">Stock: ${p.stock}</div>
                    </div>
                    <div class="flex items-center text-sm mb-3">
                        <span class="text-blue-400 mr-2">${isReseller ? 'Vendedor:' : 'Usuario:'}</span>
                        <button onclick="filterByShop('${p.seller}')" class="font-medium hover:underline text-indigo-400">${shopName}</button>
                    </div>
                    ${currentUser && currentUser.role === 'buyer' 
                        ? `<button onclick="addToCart('${p.__backendId}')" 
                            class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 rounded transition">
                            Añadir al Carrito
                        </button>`
                        : (currentUser && currentUser.role === 'reseller' && p.seller === currentUser.username)
                        ? `<button onclick="openEditModal('${p.__backendId}')" 
                            class="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-2 rounded transition">
                            Editar Producto
                        </button>`
                        : `<span class="text-sm text-gray-500">Inicia sesión como Comprador para comprar.</span>`
                    }
                </div>
            </div>
        `;
    }).join('');

    return `
        ${renderHeader(config)}
        <div class="max-w-7xl mx-auto p-4">
            
            ${selectedShopFilter ? `
                <div class="mb-4 p-4 rounded-lg bg-indigo-900 flex justify-between items-center">
                    <h2 class="text-xl font-bold">🛒 Filtrando productos de: ${selectedShopFilter}</h2>
                    <button onclick="clearShopFilter()" class="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded">
                        Eliminar Filtro
                    </button>
                </div>
            ` : ''}

            <div class="flex overflow-x-auto py-2 mb-6 border-b border-slate-700">
                ${categoriesHtml}
            </div>

            <h2 class="text-2xl font-bold mb-4">🏆 Top Tiendas (Ventas)</h2>
            <div class="flex flex-wrap mb-8 justify-center lg:justify-start">
                ${shopsHtml}
            </div>

            <h2 class="text-2xl font-bold mb-4">
                ${selectedCategory === 'all' ? 'Todos los Productos' : (CATEGORIES.find(c => c.id === selectedCategory)?.name || 'Productos')}
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                ${productsHtml.length > 0 ? productsHtml : `<div class="col-span-full text-center py-10 text-gray-400">No hay productos en esta categoría.</div>`}
            </div>
        </div>
    `;
}

function renderCart() {
    const config = getConfig();
    
    if (!currentUser || currentUser.role !== 'buyer') {
        return `<div class="p-6 text-center text-red-500">Acceso denegado.</div>`;
    }

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const cartHtml = cart.map((item, index) => {
        const product = allProducts.find(p => p.__backendId === item.backendId);
        const productValid = product && product.available && product.stock >= item.quantity;
        const shop = allUsers.find(u => u.username === item.seller);
        const shopName = shop ? shop.shop_name || item.seller : 'Vendedor Desconocido';

        return `
            <div class="flex items-center justify-between p-4 mb-4 rounded-lg shadow-md ${productValid ? '' : 'bg-red-900 border border-red-500'}" style="background-color: ${config.card_background};">
                <div class="flex items-center space-x-4">
                    <img src="${product ? product.image_url : 'https://via.placeholder.com/50'}" alt="${item.name}" class="w-12 h-12 object-contain rounded">
                    <div>
                        <div class="font-bold text-lg">${item.name}</div>
                        <div class="text-sm text-gray-400">Vendedor: ${shopName}</div>
                        ${!productValid ? `<div class="text-red-400 font-bold text-xs mt-1">⚠️ Problema de Stock/Disponibilidad</div>` : ''}
                    </div>
                </div>
                <div class="flex items-center space-x-4">
                    <div class="text-lg font-semibold text-green-400">${item.price * item.quantity} Zen</div>
                    <div class="flex items-center border border-gray-600 rounded">
                        <button onclick="removeFromCart(${index})" class="px-2 py-1 text-red-400 hover:bg-slate-700 rounded-l">-</button>
                        <span class="px-3 py-1 border-x border-gray-600">${item.quantity}</span>
                        <button onclick="addToCart('${item.backendId}')" class="px-2 py-1 text-green-400 hover:bg-slate-700 rounded-r">+</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const isCartValid = cart.length > 0 && cart.every(item => {
        const product = allProducts.find(p => p.__backendId === item.backendId);
        return product && product.available && product.stock >= item.quantity;
    });

    return `
        ${renderHeader(config)}
        <div class="max-w-4xl mx-auto p-6">
            <h2 class="text-3xl font-bold mb-6">🛒 Mi Carrito de Compras</h2>
            
            ${cart.length > 0 ? `
                <div class="mb-8">
                    ${cartHtml}
                </div>
                
                <div class="flex justify-between items-center p-6 rounded-lg shadow-xl" style="background-color: ${config.card_background};">
                    <div class="text-xl font-bold">Total:</div>
                    <div class="text-3xl font-extrabold text-green-400">${total} Zen</div>
                </div>

                <div class="mt-8">
                    <button onclick="createOrder()" ${isCartValid ? '' : 'disabled'}
                        class="w-full text-center font-bold py-3 rounded transition text-white 
                        ${isCartValid ? `bg-green-600 hover:bg-green-700` : 'bg-gray-500 cursor-not-allowed'}">
                        ${isCartValid ? `FINALIZAR COMPRA (Pagar ${total} Zen)` : '⚠️ Carrito Inválido o Vacío'}
                    </button>
                    ${!isCartValid && cart.length > 0 ? `<p class="text-red-400 text-center mt-2">Elimina los productos no disponibles antes de pagar.</p>` : ''}
                </div>
            ` : `
                <div class="text-center py-10 text-gray-400 text-xl">Tu carrito está vacío. ¡Añade algunos items!</div>
            `}
        </div>
    `;
}

function renderOrders() {
    const config = getConfig();

    if (!currentUser || (currentUser.role !== 'buyer' && currentUser.role !== 'reseller')) {
        return `<div class="p-6 text-center text-red-500">Acceso denegado.</div>`;
    }
    
    // Filtrar órdenes por el usuario actual
    const myOrders = allOrders.filter(o => 
        o.buyer_username === currentUser.username || o.seller_username === currentUser.username
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const ordersHtml = myOrders.map(order => {
        const isBuyer = order.buyer_username === currentUser.username;
        const partner = isBuyer ? order.seller_username : order.buyer_username;
        
        let statusClass = '';
        let statusText = '';
        let buttonAction = '';
        
        switch (order.order_status) {
            case 'pending':
                statusClass = 'bg-yellow-800 text-yellow-300';
                statusText = 'Pendiente de Aceptación';
                if (isBuyer) {
                     buttonAction = `<span class="text-sm text-gray-400">Esperando al vendedor...</span>`;
                } else { // Vendedor
                    buttonAction = `<button onclick="confirmOrder('${order.__backendId}', true)" class="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded transition">Aceptar Orden</button>`;
                }
                break;
            case 'confirmed_by_seller':
                statusClass = 'bg-blue-800 text-blue-300';
                statusText = 'Aceptada por Vendedor';
                if (isBuyer) {
                    buttonAction = `<button onclick="confirmOrder('${order.__backendId}', false)" class="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded transition">Confirmar Recepción</button>`;
                } else {
                    buttonAction = `<span class="text-sm text-gray-400">Esperando confirmación del comprador.</span>`;
                }
                break;
            case 'confirmed_by_buyer':
                statusClass = 'bg-purple-800 text-purple-300';
                statusText = 'Recepción Confirmada (Pendiente Cierre)';
                if (isBuyer) {
                    buttonAction = `<span class="text-sm text-gray-400">Esperando cierre final del vendedor.</span>`;
                } else {
                    buttonAction = `<button onclick="confirmOrder('${order.__backendId}', true)" class="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded transition">Cerrar Orden</button>`;
                }
                break;
            case 'completed':
                statusClass = 'bg-green-800 text-green-300';
                statusText = 'Completada';
                if (isBuyer && !order.reviewed) {
                    buttonAction = `<button onclick="showModal = 'review'; selectedOrder = '${order.__backendId}'; render()" class="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-1 px-3 rounded transition">Dejar Reseña</button>`;
                } else if (isBuyer && order.reviewed) {
                    buttonAction = `<span class="text-sm text-yellow-300">Reseña enviada</span>`;
                }
                break;
            default:
                statusClass = 'bg-gray-800 text-gray-400';
                statusText = 'Estado Desconocido';
        }

        const itemsHtml = order.items.map(item => `
            <div class="text-sm text-gray-300">${item.quantity} x ${item.name} (${item.price * item.quantity} Zen)</div>
        `).join('');

        return `
            <div class="mb-6 p-4 rounded-xl shadow-xl border border-gray-700" style="background-color: ${config.card_background};">
                <div class="flex justify-between items-center border-b border-gray-700 pb-3 mb-3">
                    <div class="text-xl font-bold">Orden #${order.__backendId.slice(-6)}</div>
                    <span class="px-3 py-1 rounded-full text-sm font-semibold ${statusClass}">${statusText}</span>
                </div>
                
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <p class="text-xs text-gray-400">Comprador:</p>
                        <p class="font-semibold">${order.buyer_username}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-400">Vendedor:</p>
                        <p class="font-semibold">${order.seller_username}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-400">Fecha:</p>
                        <p class="font-semibold">${new Date(order.created_at).toLocaleDateString()}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-400">Total:</p>
                        <p class="text-green-400 text-lg font-bold">${order.total_price} Zen</p>
                    </div>
                </div>

                <div class="border-t border-gray-700 pt-3 mb-4">
                    <p class="text-xs text-gray-400 mb-1">Items:</p>
                    ${itemsHtml}
                </div>
                
                <div class="flex justify-between items-center pt-3 border-t border-gray-700">
                    <button onclick="openChatModal('${order.__backendId}')" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded transition">
                        💬 Chatear con ${partner}
                    </button>
                    ${buttonAction}
                </div>
            </div>
        `;
    }).join('');

    return `
        ${renderHeader(config)}
        <div class="max-w-4xl mx-auto p-6">
            <h2 class="text-3xl font-bold mb-6">📦 Historial de Órdenes</h2>
            
            ${myOrders.length > 0 ? ordersHtml : `
                <div class="text-center py-10 text-gray-400 text-xl">No tienes órdenes aún.</div>
            `}
        </div>
    `;
}

function renderAdmin() {
    const config = getConfig();

    if (!currentUser || currentUser.role !== 'admin') {
        return `<div class="p-6 text-center text-red-500">Acceso denegado.</div>`;
    }
    
    let content = '';

    if (adminViewTarget) {
        // Vista de Gestión de Tienda Específica
        content = renderShopManagement();
    } else {
        // Vista de Dashboard Admin General
        const pendingResellers = allUsers.filter(u => u.role === 'reseller' && !u.approved);
        const allResellers = allUsers.filter(u => u.role === 'reseller' && u.approved);
        const allBuyers = allUsers.filter(u => u.role === 'buyer');
        
        const pendingHtml = pendingResellers.map(u => `
            <div class="flex justify-between items-center p-3 mb-2 rounded-lg bg-red-900 border border-red-500">
                <span class="font-semibold">${u.username}</span>
                <button onclick="openManageUserModal('${u.username}')" class="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded transition">Revisar</button>
            </div>
        `).join('');
        
        const resellerHtml = allResellers.map(u => {
            const shopName = u.shop_name || 'Sin Tienda';
            const sales = getSellerSalesMap()[u.username] || 0;
            return `
                <div class="flex justify-between items-center p-3 mb-2 rounded-lg bg-slate-700">
                    <div class="flex flex-col">
                        <span class="font-semibold">${u.username} (${shopName})</span>
                        <span class="text-xs text-gray-400">${sales} ventas</span>
                    </div>
                    <button onclick="openManageUserModal('${u.username}')" class="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-1 px-3 rounded transition">Gestionar</button>
                </div>
            `;
        }).join('');
        
        const buyerHtml = allBuyers.map(u => `
            <div class="flex justify-between items-center p-3 mb-2 rounded-lg bg-slate-700">
                <span class="font-semibold">${u.username}</span>
                <button onclick="openManageUserModal('${u.username}')" class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-1 px-3 rounded transition">Gestionar</button>
            </div>
        `).join('');

        const completedOrders = allOrders.filter(o => o.order_status === 'completed');

        content = `
            <h2 class="text-3xl font-bold mb-6">👑 Dashboard de Administración</h2>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="p-4 rounded-xl shadow-xl" style="background-color: ${config.card_background};">
                    <h3 class="text-xl font-bold mb-3">Órdenes</h3>
                    <p>Órdenes totales completadas: <span class="text-green-400 font-bold">${completedOrders.length}</span></p>
                    <button onclick="clearCompletedOrdersLog()" class="mt-3 w-full bg-red-700 hover:bg-red-800 text-white py-2 rounded transition text-sm">
                        Limpiar Log de Órdenes Completadas
                    </button>
                </div>
                
                <div class="p-4 rounded-xl shadow-xl" style="background-color: ${config.card_background};">
                    <h3 class="text-xl font-bold mb-3">🚨 Solicitudes Pendientes (${pendingResellers.length})</h3>
                    ${pendingResellers.length > 0 ? pendingHtml : `<p class="text-green-400">No hay solicitudes pendientes.</p>`}
                </div>
                
                <div class="p-4 rounded-xl shadow-xl" style="background-color: ${config.card_background};">
                    <h3 class="text-xl font-bold mb-3">Resellers Activos</h3>
                    <p>Total: ${allResellers.length}</p>
                    <button onclick="currentView = 'orders'; render()" class="mt-3 w-full bg-purple-500 hover:bg-purple-600 text-white py-2 rounded transition text-sm">
                        Ver Órdenes Pendientes
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 class="text-2xl font-bold mb-4">Gestión de Resellers (${allResellers.length})</h3>
                    ${resellerHtml.length > 0 ? resellerHtml : `<p class="text-gray-400">No hay resellers activos.</p>`}
                </div>
                <div>
                    <h3 class="text-2xl font-bold mb-4">Gestión de Compradores (${allBuyers.length})</h3>
                    ${buyerHtml.length > 0 ? buyerHtml : `<p class="text-gray-400">No hay compradores registrados.</p>`}
                </div>
            </div>
        `;
    }

    return `
        ${renderHeader(config)}
        <div class="max-w-7xl mx-auto p-6">
            ${content}
        </div>
    `;
}

function renderShopManagement() {
    const config = getConfig();
    const targetUser = allUsers.find(u => u.username === adminViewTarget);

    if (!targetUser) {
        adminViewTarget = null;
        return `<div class="text-red-500">Usuario no encontrado.</div>`;
    }

    const products = allProducts.filter(p => p.seller === adminViewTarget);
    const shopName = targetUser.shop_name || targetUser.username;

    const productsHtml = products.map(p => `
        <div class="flex justify-between items-center p-3 mb-2 rounded-lg bg-slate-700">
            <div class="flex flex-col">
                <span class="font-semibold">${p.name}</span>
                <span class="text-xs text-gray-400">Stock: ${p.stock} | Precio: ${p.price} Zen</span>
            </div>
            <div class="flex space-x-2">
                <button onclick="openEditModal('${p.__backendId}')" class="bg-yellow-500 hover:bg-yellow-600 text-gray-900 py-1 px-3 rounded transition text-sm">Editar</button>
                <button onclick="deleteProduct('${p.__backendId}')" class="bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded transition text-sm">Eliminar</button>
            </div>
        </div>
    `).join('');

    return `
        <div class="flex justify-between items-center mb-6 border-b pb-3">
            <h2 class="text-3xl font-bold">🛠️ Gestión de Tienda: ${shopName}</h2>
            <button onclick="adminViewTarget = null; render()" class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded transition">
                Volver al Admin Dashboard
            </button>
        </div>
        
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 p-6 rounded-xl shadow-xl" style="background-color: ${config.card_background};">
                <h3 class="text-2xl font-bold mb-4">➕ Agregar Nuevo Producto</h3>
                <form onsubmit="handleAddProduct(event)">
                    <input type="hidden" name="seller" value="${targetUser.username}">
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Nombre</label>
                        <input type="text" name="name" required class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                    </div>
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Categoría</label>
                        <select name="category" required class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                            ${CATEGORIES.filter(c => c.id !== 'all' && c.id !== 'promotions').map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label class="block text-sm font-medium mb-1">Precio (Zen)</label>
                            <input type="number" name="price" required min="1" step="0.01" class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1">Stock</label>
                            <input type="number" name="stock" required min="1" class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                        </div>
                    </div>
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Descripción</label>
                        <textarea name="description" rows="3" class="w-full p-2 rounded bg-slate-800 border border-slate-700"></textarea>
                    </div>
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">URL Imagen</label>
                        <input type="url" name="image_url" class="w-full p-2 rounded bg-slate-800 border border-slate-700" placeholder="Opcional">
                    </div>
                    <div class="mb-4 flex items-center">
                        <input type="checkbox" name="is_promotion" id="is_promotion" class="h-4 w-4 text-blue-600 rounded">
                        <label for="is_promotion" class="ml-2 text-sm font-medium">Marcar como Promoción 🔥</label>
                    </div>
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition">
                        Publicar Producto
                    </button>
                </form>
            </div>

            <div class="lg:col-span-2 p-6 rounded-xl shadow-xl" style="background-color: ${config.card_background};">
                <h3 class="text-2xl font-bold mb-4">Productos Publicados (${products.length})</h3>
                <div class="max-h-96 overflow-y-auto pr-2">
                    ${productsHtml.length > 0 ? productsHtml : '<p class="text-gray-400">No has publicado ningún producto.</p>'}
                </div>
            </div>
        </div>
    `;
}


// --- Renderizado de Modales ---

function renderModal() {
    const config = getConfig();
    let modalContent = '';
    let title = '';

    const modalBodyStyle = `background-color: ${config.card_background}; color: ${config.text_color};`;

    switch (showModal) {
        case 'login':
            title = 'Acceder al Marketplace';
            modalContent = `
                <form onsubmit="handleLogin(event)" class="space-y-4">
                    <input type="text" name="username" placeholder="Usuario" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <input type="password" name="password" placeholder="Contraseña" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded transition">
                        Iniciar Sesión
                    </button>
                </form>
                <div class="mt-4 border-t border-slate-700 pt-4 text-center">
                    <p class="text-sm mb-2">¿No tienes cuenta?</p>
                    <button onclick="showModal = 'registerBuyer'; render()" class="text-green-400 hover:underline text-sm font-semibold">
                        Registrarme como Comprador
                    </button>
                    <p class="text-xs text-gray-400 mt-2">o</p>
                    <button onclick="showModal = 'registerReseller'; render()" class="text-yellow-400 hover:underline text-sm font-semibold">
                        Solicitar cuenta de Revendedor
                    </button>
                </div>
            `;
            break;
        case 'registerBuyer':
             title = 'Registro de Comprador';
             modalContent = `
                <form onsubmit="handleRegisterBuyer(event)" class="space-y-4">
                    <input type="text" name="username" placeholder="Usuario" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <input type="password" name="password" placeholder="Contraseña" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <input type="text" name="contact" placeholder="Contacto (Discord/WhatsApp)" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <button type="submit" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded transition">
                        Registrar y Acceder
                    </button>
                </form>
                <button onclick="showModal = 'login'; render()" class="mt-4 text-sm text-gray-400 hover:text-white">
                    ← Volver a Iniciar Sesión
                </button>
            `;
            break;
        case 'registerReseller':
            title = 'Solicitud de Revendedor';
            modalContent = `
                <form onsubmit="handleRegisterReseller(event)" class="space-y-4">
                    <p class="text-sm text-yellow-400">Tu cuenta requerirá aprobación del Administrador.</p>
                    <input type="text" name="username" placeholder="Usuario" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <input type="password" name="password" placeholder="Contraseña" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <input type="text" name="contact" placeholder="Contacto (Discord/WhatsApp)" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <button type="submit" class="w-full bg-yellow-600 hover:bg-yellow-700 text-gray-900 font-bold py-3 rounded transition">
                        Enviar Solicitud
                    </button>
                </form>
                <button onclick="showModal = 'login'; render()" class="mt-4 text-sm text-gray-400 hover:text-white">
                    ← Volver a Iniciar Sesión
                </button>
            `;
            break;
        case 'setupShop':
            title = 'Configurar mi Tienda';
            modalContent = `
                <form onsubmit="handleSetupShop(event)" class="space-y-4">
                    <p class="text-sm text-blue-400">Elige un nombre de fantasía para tu tienda. (Ej: "La Cueva del Zen")</p>
                    <input type="text" name="shopName" placeholder="Nombre de Tienda (Único)" required class="w-full p-3 rounded bg-slate-800 border border-slate-700">
                    <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded transition">
                        Guardar Nombre
                    </button>
                </form>
            `;
            break;
        case 'editProduct':
            if (!selectedProductToEdit) return '';
            title = `Editar: ${selectedProductToEdit.name}`;
            modalContent = `
                <form onsubmit="handleUpdateProduct(event)" class="space-y-4">
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Nombre</label>
                        <input type="text" name="name" value="${selectedProductToEdit.name}" required class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label class="block text-sm font-medium mb-1">Precio (Zen)</label>
                            <input type="number" name="price" value="${selectedProductToEdit.price}" required min="1" step="0.01" class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1">Stock</label>
                            <input type="number" name="stock" value="${selectedProductToEdit.stock}" required min="0" class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                        </div>
                    </div>
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Descripción</label>
                        <textarea name="description" rows="3" class="w-full p-2 rounded bg-slate-800 border border-slate-700">${selectedProductToEdit.description}</textarea>
                    </div>
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">URL Imagen</label>
                        <input type="url" name="image_url" value="${selectedProductToEdit.image_url || ''}" class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                    </div>
                    <div class="flex justify-between">
                        <div class="flex items-center">
                            <input type="checkbox" name="is_promotion" id="edit_promotion" ${selectedProductToEdit.is_promotion ? 'checked' : ''} class="h-4 w-4 text-blue-600 rounded">
                            <label for="edit_promotion" class="ml-2 text-sm font-medium">Promoción 🔥</label>
                        </div>
                        <div class="flex items-center">
                            <input type="checkbox" name="available" id="edit_available" ${selectedProductToEdit.available ? 'checked' : ''} class="h-4 w-4 text-green-600 rounded">
                            <label for="edit_available" class="ml-2 text-sm font-medium">Disponible</label>
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded transition mt-4">
                        Guardar Cambios
                    </button>
                    <button type="button" onclick="deleteProduct('${selectedProductToEdit.__backendId}'); showModal=null; render();" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded transition mt-2">
                        Eliminar Producto
                    </button>
                </form>
            `;
            break;
        case 'manageUser':
            if (!managedUser) return '';
            const userStatus = managedUser.approved 
                ? (managedUser.role === 'reseller' ? 'Aprobado' : 'Activo')
                : 'Pendiente de Aprobación';
            title = `Gestionar Usuario: ${managedUser.username}`;
            modalContent = `
                <div class="space-y-4">
                    <p><strong>Rol:</strong> <span class="font-bold">${managedUser.role.toUpperCase()}</span></p>
                    <p><strong>Estado:</strong> <span class="font-bold text-yellow-400">${userStatus}</span></p>
                    <p><strong>Contacto:</strong> ${managedUser.contact}</p>
                    ${managedUser.role === 'reseller' ? `<p><strong>Tienda:</strong> ${managedUser.shop_name || 'No configurada'}</p>` : ''}
                    
                    ${managedUser.role === 'reseller' && !managedUser.approved 
                        ? `
                        <p class="text-lg font-bold text-red-400">Acciones de Aprobación:</p>
                        <button onclick="approveUser('${managedUser.__backendId}')" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded transition">
                            ✅ Aprobar Revendedor
                        </button>
                        <button onclick="rejectUser('${managedUser.__backendId}')" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded transition">
                            ❌ Rechazar Solicitud
                        </button>
                        ` 
                        : managedUser.role !== 'admin' ? `
                        <p class="text-lg font-bold text-red-400">Acciones de Administración:</p>
                        ${managedUser.role !== 'banned' ? `
                            <button onclick="banUser('${managedUser.__backendId}')" class="w-full bg-yellow-600 hover:bg-yellow-700 text-gray-900 font-bold py-2 rounded transition">
                                🚫 Banear Usuario
                            </button>
                        ` : ''}
                        ${managedUser.role === 'reseller' ? `
                            <button onclick="enterShopManagement('${managedUser.username}'); showModal=null;" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition mt-2">
                                🛠️ Gestionar Productos
                            </button>
                        ` : ''}
                        <button onclick="deleteUserAccount('${managedUser.__backendId}')" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded transition mt-2">
                            🗑️ Eliminar Cuenta
                        </button>
                        ` : ''
                    }
                </div>
            `;
            break;
        case 'review':
            if (!selectedOrder) return '';
            const orderToReview = allOrders.find(o => o.__backendId === selectedOrder);
            if (!orderToReview) return '';
            title = `Dejar Reseña para Orden #${selectedOrder.slice(-4)}`;
            modalContent = `
                <form onsubmit="handleSubmitReview(event)" class="space-y-4">
                    <input type="hidden" name="orderId" value="${selectedOrder}">
                    <p class="text-lg">Vendedor: <span class="font-bold text-blue-400">${orderToReview.seller_username}</span></p>
                    
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Puntuación (1-5)</label>
                        <select name="rating" required class="w-full p-2 rounded bg-slate-800 border border-slate-700">
                            <option value="5">5 - Excelente ⭐⭐⭐⭐⭐</option>
                            <option value="4">4 - Muy Bueno</option>
                            <option value="3">3 - Regular</option>
                            <option value="2">2 - Malo</option>
                            <option value="1">1 - Pésimo</option>
                        </select>
                    </div>
                    <div class="mb-3">
                        <label class="block text-sm font-medium mb-1">Comentario</label>
                        <textarea name="comment" rows="3" placeholder="Describe tu experiencia..." required class="w-full p-2 rounded bg-slate-800 border border-slate-700"></textarea>
                    </div>
                    <button type="submit" class="w-full bg-yellow-600 hover:bg-yellow-700 text-gray-900 font-bold py-3 rounded transition">
                        Enviar Reseña
                    </button>
                </form>
            `;
            break;
        case 'chat':
            if (!chatTargetOrder) return '';
            const isOrderBuyer = chatTargetOrder.buyer_username === currentUser.username;
            const chatPartner = isOrderBuyer ? chatTargetOrder.seller_username : chatTargetOrder.buyer_username;
            title = `💬 Chat Orden #${chatTargetOrder.__backendId.slice(-4)} con ${chatPartner}`;
            modalContent = `
                <div class="flex flex-col h-full">
                    <div class="chat-messages p-4 flex-grow" id="chat-messages-container">
                        </div>
                    <form onsubmit="handleChatMessageSend(event)" class="flex p-4 border-t border-slate-700">
                        <input type="text" id="chatInput" placeholder="Escribe tu mensaje..." required class="flex-grow p-3 rounded-l-lg bg-slate-800 border border-slate-700 focus:outline-none">
                        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 rounded-r-lg transition">
                            Enviar
                        </button>
                    </form>
                </div>
            `;
            // El renderizado de mensajes se hace después de la suscripción en openChatModal
            break;
    }

    // Estructura de Modal Base
    return `
        <div class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onclick="if(showModal !== 'chat') {showModal = null; render();}">
            <div class="relative w-full max-w-lg rounded-xl shadow-2xl animate-bounce-in" 
                 style="${modalBodyStyle}" 
                 onclick="event.stopPropagation()">
                <div class="p-6">
                    <h3 class="text-2xl font-bold mb-4 border-b pb-2 flex justify-between items-center">
                        ${title}
                        <button onclick="${showModal === 'chat' ? 'closeChatModal()' : 'showModal = null; render();'}" class="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                    </h3>
                    ${modalContent}
                </div>
            </div>
        </div>
    `;
}

// --- Inicialización ---
async function init() {
    // Cargar usuario de la sesión
    const storedUser = localStorage.getItem(SESSION_KEY);
    if (storedUser) {
      currentUser = JSON.parse(storedUser);
      showToast(`👋 Sesión restaurada: ${currentUser.username}`);
    }

    setupAutoLogout();

    // Iniciar SDK de Datos (lee de JSONBin y notifica a dataHandler)
    await window.dataSdk.init(dataHandler);
    
    // Iniciar SDK de Elementos (para manejar configuración dinámica)
    if (window.elementSdk) {
      window.elementSdk.init({
        defaultConfig,
        onConfigChange: async (config) => {
          document.body.style.backgroundColor = config.background_color || defaultConfig.background_color;
          document.body.style.color = config.text_color || defaultConfig.text_color;
          const baseSize = config.font_size || defaultConfig.font_size;
          document.body.style.fontSize = `${baseSize}px`;
          render();
        }
      });
    }
    
    if (currentUser) updateUserActivity();
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
// == 6. INICIO DE LA APLICACIÓN                            ==
// =========================================================
init();