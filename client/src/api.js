import axios from "axios";

const api = axios.create({
  baseURL: "/api", 
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error("API Error:", err.response?.data || err.message);
    throw err;
  }
);

export default api;