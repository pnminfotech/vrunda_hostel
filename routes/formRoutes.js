// routes/formRoutes.js
const express = require("express");
const router = express.Router();

// Models (used by a couple of inline routes)
const Form = require("../models/formModels");

// Controllers
const {
  getNextSrNo,
  rentAmountDel,
  processLeave,
  getFormById,
  getForms,
  updateFormById,
  updateProfile,
  getArchivedForms,
  saveLeaveDate,
  restoreForm,
  archiveForm,
  getDuplicateForms,
  deleteForm,
  updateForm,
  saveForm, // kept/exported for legacy use (NOT bound to POST /forms)
  getAllForms,
} = require("../controllers/formController");

const {
  createWithOptionalInvite,
} = require("../controllers/forms/createWithOptionalInvite");
const { importTenants } = require("../controllers/forms/importTenants");

// NEW: invite controller routes
const { createInvite, validateInvite } = require("../controllers/invites");

// ───────────────────────────────────────────────────────────────────────────────
// CREATE: must be the ONLY creator for /forms
// NOTE: Inside createWithOptionalInvite, you should also use
//       assignNextSrNoAndUpdateCounter() from formController
//       instead of trusting srNo from frontend.
// ───────────────────────────────────────────────────────────────────────────────
router.post("/forms", createWithOptionalInvite);
router.post("/forms/import", importTenants);

// For UI to show next SrNo (server still assigns the real one)
router.get("/forms/count", getNextSrNo);

// ───────────────────────────────────────────────────────────────────────────────
// INVITES (create + validate)
// ───────────────────────────────────────────────────────────────────────────────
router.post("/invites", createInvite);
router.get("/invites/:token", validateInvite);

// ───────────────────────────────────────────────────────────────────────────────
// READ / UPDATE / DELETE
// ───────────────────────────────────────────────────────────────────────────────
router.get("/", getAllForms);

router.delete("/form/:id", deleteForm);
router.get("/duplicateforms", getDuplicateForms);

router.post("/forms/leave", saveLeaveDate);
router.post("/forms/archive", archiveForm);
router.post("/forms/restore", restoreForm);

router.put("/update/:id", updateProfile);
router.get("/forms", getForms);
router.post("/leave", processLeave);

router.get("/forms/archived", getArchivedForms);
router.get("/form/:id", getFormById);
// ✅ UPDATE full form record (tenant intake update)
// router.patch("/forms/:id", updateFormById);
router.put("/forms/:id", updateFormById);

// rent entry delete by monthKey
router.delete("/form/:formId/rent/:monthYear", rentAmountDel);

// rent create/update
router.put("/form/:id", updateForm);

// cancel leave inline route
router.post("/cancel-leave", async (req, res) => {
  const { id, roomNo, bedNo, floorNo, category, baseRent } = req.body;
  try {
    const tenant = await Form.findById(id);
    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });

    const nextRoomNo = String(roomNo || tenant.roomNo || "").trim();
    const nextBedNo = String(bedNo || tenant.bedNo || "").trim();
    const occupants = await Form.find({
      _id: { $ne: tenant._id }, roomNo: nextRoomNo, bedNo: nextBedNo,
    }).select("name leaveDate").lean();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const occupiedBy = occupants.find((item) => {
      if (!item.leaveDate) return true;
      const leave = new Date(item.leaveDate);
      if (Number.isNaN(leave.getTime())) return true;
      leave.setHours(0, 0, 0, 0);
      return leave >= today;
    });
    if (occupiedBy) {
      return res.status(409).json({
        success: false,
        message: `This bed is currently occupied by ${occupiedBy.name || "another tenant"}.`,
      });
    }

    tenant.roomNo = nextRoomNo;
    tenant.bedNo = nextBedNo;
    if (floorNo !== undefined) tenant.floorNo = floorNo;
    if (category !== undefined) tenant.category = category;
    if (baseRent !== undefined && Number(baseRent) > 0) tenant.baseRent = Number(baseRent);
    tenant.leaveDate = undefined;
    await tenant.save();
    res.json({ success: true, tenant });
  } catch (error) {
    res.status(500).json({ success: false, error: "Error cancelling leave" });
  }
});

module.exports = router;
