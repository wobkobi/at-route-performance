import axios from "axios";

const base = process.env.NEXT_PUBLIC_API_URL!;
export default axios.create({baseURL: base});
