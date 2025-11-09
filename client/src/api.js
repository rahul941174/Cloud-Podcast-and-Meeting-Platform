import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

const api = axios.create({
    baseURL: BACKEND_URL,
    withCredentials: true,  // Send cookies with requests
    headers: {
        'Content-Type': 'application/json',
    }
});

// ✅ Request interceptor - Add token to headers if available
api.interceptors.request.use(
    (config) => {
        // Try to get token from localStorage (backup)
        const token = localStorage.getItem('authToken');
        
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// ✅ Response interceptor - Handle errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // If 401 Unauthorized, clear token and redirect
        if (error.response?.status === 401) {
            console.log('❌ Unauthorized - clearing token');
            localStorage.removeItem('authToken');
            
            // Only redirect if not already on login/signup
            const currentPath = window.location.pathname;
            if (currentPath !== '/login' && currentPath !== '/signup') {
                window.location.href = '/login';
            }
        }
        
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

export default api;