// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

const { connectDB } = require("./config/db");

// Routers
const formRoutes = require("./routes/formRoutes");
const maintenanceRoutes = require("./routes/MaintRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const projectRoutes = require("./routes/Project");
const roomRoutes = require("./routes/roomRoutes");
const lightBillRoutes = require("./routes/lightBillRoutes");
const otherExpenseRoutes = require("./routes/otherExpenseRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const authRoutes = require("./routes/authRoutes");
const formWithDocsRoutes = require("./routes/formWithDocs");
const documentRoutes = require("./routes/documentRoutes");
const tenantRoutes = require("./routes/tenant");
const paymentRoutes = require("./routes/payments");
const leaveRoutes = require("./routes/leaveRoutes");
const adminNotificationsRouter = require("./routes/adminattendenceNotifications");
const adminLeaveRoutes = require("./routes/adminLeaveRoutes");
 const tenantDocsRoutes = require("./routes/tenantDocs");
const invitesRouter = require("./routes/invites");
dotenv.config();

const app = express();

/* ----------------------------- Middleware ------------------------------ */
app.use(cors());
app.use(express.json());

// Static files for uploaded content
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/tenant", tenantDocsRoutes);

// Chrome DevTools CSP probe (cosmetic)
app.get(
  "/.well-known/appspecific/com.chrome.devtools.json",
  (_req, res) => res.sendStatus(204)
);

// Health check
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "dev" })
);

/* ------------------------------- Routes -------------------------------- */

// Base collections under /api
app.use("/api", authRoutes);
app.use("/api", formRoutes);
app.use("/api/", formWithDocsRoutes);
app.use("/api", projectRoutes);

// Namespaced mounts
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/suppliers", supplierRoutes);

// ✅ Room routes (used by RoomManager frontend)
app.use("/api/rooms", roomRoutes);

app.use("/api/light-bill", lightBillRoutes);
app.use("/api/other-expense", otherExpenseRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/documents", documentRoutes);

// ✅ Tenant module (single mount for all tenant APIs)
app.use("/api/tenant", tenantRoutes);

// Payments
app.use("/api/payments", paymentRoutes);
app.use("/api/invites", invitesRouter);
// Leaves
app.use("/api/tenant/leaves", leaveRoutes);
app.use("/api/staff-expenses", require("./routes/staffExpenseRoutes"));

// Notifications
app.use("/api", require("./routes/notifications"));

// Admin leave + attendance
app.use("/api/admin", adminLeaveRoutes);
app.use("/api", require("./routes/tenantAttendance"));
app.use("/api/admin", adminNotificationsRouter);

/* ----------------------- Route listing (optional) ---------------------- */
function listRoutes(appInstance) {
  if (!appInstance?._router?.stack) {
    console.log("No routes mounted yet.");
    return;
  }
  const rows = [];
  appInstance._router.stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods)
        .map((m) => m.toUpperCase())
        .join(",");
      rows.push(`${methods.padEnd(10)} ${layer.route.path}`);
    } else if (layer.name === "router" && layer.handle?.stack) {
      const mountPath =
        layer.regexp
          ?.toString()
          .replace(/\\/g, "")
          .match(/^\/\^\\(.*)\\\/\?\$\//)?.[1] || "";
      layer.handle.stack.forEach((h) => {
        if (h.route) {
          const methods = Object.keys(h.route.methods)
            .map((m) => m.toUpperCase())
            .join(",");
          rows.push(
            `${methods.padEnd(10)} /${mountPath}${
              h.route.path === "/" ? "" : h.route.path
            }`
          );
        }
      });
    }
  });
  console.log("== Registered routes ==");
  rows.forEach((r) => console.log(r));
}

// Only log routes in dev
if (process.env.NODE_ENV !== "production") {
  listRoutes(app);
}

/* ---------------------------- DB + Server ------------------------------ */
connectDB();

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log(`   Try: http://localhost:${PORT}/api/health`);
});
