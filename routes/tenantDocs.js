// routes/tenantDocs.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Form = require("../models/Form"); // ⬅️ Make sure this path/model name is correct
const Invite = require("../models/Invite");

const router = express.Router();

/* ================== Ensure upload folder exists ================== */
const uploadDir = path.join(__dirname, "..", "uploads", "tenant_docs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/* ================== Multer config (disk storage) ================== */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

/**
 * POST /api/tenant/with-docs
 *
 * Body fields (sent as form-data text fields):
 *   srNo, name, joiningDate, roomNo, bedNo, depositAmount,
 *   address, phoneNo,
 *   relativeAddress,
 *   relative1Relation, relative1Name, relative1Phone,
 *   relative2Relation, relative2Name, relative2Phone,
 *   companyAddress, dateOfJoiningCollege, dob,
 *   baseRent, rentAmount, ...
 *
 * Files (sent as form-data file fields):
 *   selfAadhar, parentAadhar, photo
 */
// router.post(
//   "/with-docs",
//   upload.fields([
//     { name: "selfAadhar", maxCount: 1 },
//     { name: "parentAadhar", maxCount: 1 },
//     { name: "photo", maxCount: 1 },
//   ]),
//   async (req, res) => {
//     try {
//       console.log("REQ BODY BEFORE FIX:", req.body);

//       // 🔒 Ensure srNo exists
//       if (req.body.srNo === undefined || req.body.srNo === null || req.body.srNo === "") {
//         const lastForm = await Form.findOne().sort({ srNo: -1 });
//         req.body.srNo = lastForm ? lastForm.srNo + 1 : 1;
//       }
//       req.body.srNo = Number(req.body.srNo);

//       // Prepare data to save/update
//       const updateData = { ...req.body };

//       // Attach files if uploaded
//       if (req.files?.selfAadhar) updateData.selfAadhar = req.files.selfAadhar[0].path;
//       if (req.files?.parentAadhar) updateData.parentAadhar = req.files.parentAadhar[0].path;
//       if (req.files?.photo) updateData.photo = req.files.photo[0].path;

//       let savedForm;

//       // 🔑 If formId exists → update, else create new
//       if (req.body.formId && req.body.formId !== "undefined") {
//         savedForm = await Form.findByIdAndUpdate(req.body.formId, { $set: updateData }, { new: true });
//         if (!savedForm) return res.status(404).json({ message: "Form not found" });
//       } else {
//         const newForm = new Form(updateData);
//         savedForm = await newForm.save();
//       }

//       res.status(200).json({
//         message: req.body.formId ? "Tenant details updated successfully" : "Form saved successfully",
//         data: savedForm,
//       });

//     } catch (error) {
//       console.error("Error in POST /api/tenant/with-docs:", error);
//       res.status(500).json({ message: error.message });
//     }
//   }
// );

router.post(
  "/with-docs",
  upload.fields([
    { name: "selfAadhar", maxCount: 1 },
    { name: "parentAadhar", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("REQ BODY:", req.body);

      let { formId, inv } = req.body;

      // ✅ If formId missing but invite token present → fetch usedByFormId
      let inviteDoc = null;
      if ((!formId || formId === "undefined") && inv) {
        const now = new Date();
        inviteDoc = await Invite.findOne({
          token: inv,
          expiresAt: { $gt: now },
        });

        if (!inviteDoc?.usedByFormId) {
          return res.status(400).json({ message: "Invalid/expired invite link" });
        }

        formId = String(inviteDoc.usedByFormId);
      }

      // ✅ Build PATCH update (ignore empty fields)
      function buildPatch(body) {
        const patch = {};

        for (const [k, v] of Object.entries(body || {})) {
          if (["formId", "inv", "srNo"].includes(k)) continue;
          if (v === undefined || v === null) continue;
          if (v === "" || v === "undefined") continue; // ignore empty strings
          patch[k] = v;
        }

        // 🔒 Safety: never allow these via this route
        delete patch.rents;
        delete patch.rentPaid;
        delete patch.month;
        delete patch.date;

        // Convert money fields
        const moneyFields = ["baseRent", "rentAmount", "depositAmount"];
        for (const f of moneyFields) {
          if (patch[f] !== undefined) {
            const n = Number(String(patch[f]).replace(/[,₹\s]/g, ""));
            if (!Number.isFinite(n)) delete patch[f];
            else patch[f] = n;
          }
        }

        // Normalize phone fields (optional safety)
        const phoneFields = ["phoneNo", "relative1Phone", "relative2Phone"];
        for (const f of phoneFields) {
          if (patch[f] !== undefined) {
            patch[f] = String(patch[f]).replace(/\D/g, "").slice(0, 10);
            if (!patch[f]) delete patch[f];
          }
        }

        return patch;
      }

      const updateData = buildPatch(req.body);

      // ✅ Attach files (files should override)
      if (req.files?.selfAadhar) updateData.selfAadhar = req.files.selfAadhar[0].path;
      if (req.files?.parentAadhar) updateData.parentAadhar = req.files.parentAadhar[0].path;
      if (req.files?.photo) updateData.photo = req.files.photo[0].path;

      // ✅ If invite exists → lock fields that were prefilled by admin
      if (inv) {
        if (!inviteDoc) {
          const now = new Date();
          inviteDoc = await Invite.findOne({ token: inv, expiresAt: { $gt: now } });
        }

        const lockedKeys = Object.keys(inviteDoc?.prefill || {});
        lockedKeys.forEach((k) => delete updateData[k]);

        // (optional) force-lock these always if you want:
        // ["name","phoneNo","roomNo","bedNo","depositAmount","joiningDate"].forEach(k => delete updateData[k]);
      }

      // ✅ If inv present but still no formId → reject
      if (inv && (!formId || formId === "undefined")) {
        return res.status(400).json({ message: "Invalid/expired invite link" });
      }

      let savedForm;

      // ✅ UPDATE (normal tenant flow)
      if (formId && formId !== "undefined") {
        savedForm = await Form.findByIdAndUpdate(
          formId,
          { $set: updateData },
          { new: true, runValidators: true }
        );

        if (!savedForm) return res.status(404).json({ message: "Form not found" });

        // ✅ Mark invite used (only if still unused)
        if (inv) {
          await Invite.updateOne(
            { token: inv, usedAt: null },
            { $set: { usedAt: new Date(), usedByFormId: savedForm._id } }
          );
        }

        return res.status(200).json({
          message: "Tenant details updated successfully",
          formId: savedForm._id,
          data: savedForm,
        });
      }

      // ✅ CREATE (only when no invite; e.g. admin direct upload)
      const lastForm = await Form.findOne().sort({ srNo: -1 });
      const srNo = lastForm ? lastForm.srNo + 1 : 1;

      savedForm = await Form.create({ ...updateData, srNo });

      return res.status(201).json({
        message: "Form saved successfully",
        formId: savedForm._id,
        data: savedForm,
      });
    } catch (error) {
      console.error("Error in /with-docs:", error);
      res.status(500).json({ message: error.message });
    }
  }
);



module.exports = router;
