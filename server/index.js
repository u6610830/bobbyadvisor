import express from "express";
import cors from "cors";
import supabase from "./supabase.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend is working");
});

app.get("/grades", async (req, res) => {
  const { data, error } = await supabase
    .from("grades")
    .select("*");

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  res.json(data);
});

app.listen(3001, () => {
  console.log("Server running on port 3001");
});