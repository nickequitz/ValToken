import axios from 'axios';

// Create an instance of axios with the base URL
const api = axios.create({
    baseURL: "http://localhost:8001",
    headers: {
        'Content-Type': 'application/json'
    }
});

// Function to set the token
const setToken = (token) => {
    if (token) {
        localStorage.setItem('token', token);
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
        localStorage.removeItem('token');
        delete api.defaults.headers.common['Authorization'];
    }
};

// Add a request interceptor to include the token in requests
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        // For form data requests, remove Content-Type to let the browser set it
        if (config.data instanceof FormData) {
            delete config.headers['Content-Type'];
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add a response interceptor to handle authentication errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            setToken(null);
        }
        return Promise.reject(error);
    }
);

// Export the Axios instance and setToken function
export { setToken };
export default api; 
