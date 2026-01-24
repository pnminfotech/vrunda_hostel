const express = require("express");
const multer = require("multer");
const sharp = require("sharp");

const router = express.Router();

const Form = require("../models/formModels");
const Counter = require("../models/counterModel");

const ImageKit = require("imagekit");

// ✅ ImageKit init (won’t crash if env missing; we will check canUseImagekit)
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
});

const upload = multer({ storage: multer.memoryStorage() });
const TARGET = 10 * 1024; // 10 KB

// ✅ helper: compress image under 10KB
async function compressUnder10KB(buf) {
  let q = 80,
    w = null;

  let out = await sharp(buf).webp({ quality: q }).toBuffer();

  while (out.length > TARGET && (q > 30 || w === null || w > 200)) {
    if (q > 30) q -= 10;
    else {
      const meta = await sharp(buf).metadata();
      w = w || meta.width || 800;
      w = Math.max(200, Math.floor(w * 0.8));
    }

    const p = sharp(buf);
    if (w) p.resize({ width: w, withoutEnlargement: true });
    out = await p.webp({ quality: q }).toBuffer();
  }

  if (out.length > TARGET) {
    out = await sharp(buf)
      .resize({ width: 200, withoutEnlargement: true })
      .webp({ quality: 25 })
      .toBuffer();
  }

  return out;
}

/* =========================
   ✅ RENT REQUIRED FIELDS HELPERS
   (Adds month + paymentMode without breaking existing logic)
========================= */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtMonthKey(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return `${MONTHS[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; // e.g., "Jan-26"
}

router.post(
  "/forms-with-docs",
  upload.array("documents", 10),
  async (req, res) => {
    try {
      const body = req.body || {};
      const formId = body.formId ? String(body.formId).trim() : null;

      const toDate = (v) => (v ? new Date(v) : undefined);
      const toNum = (v) => (v !== undefined && v !== "" ? Number(v) : undefined);

      const joiningDate = toDate(body.joiningDate);
      const rentAmount = toNum(body.rentAmount ?? body.baseRent);

      if (!rentAmount) {
        return res
          .status(400)
          .json({ ok: false, message: "rentAmount is required" });
      }

      // ✅ these are required in your rents schema
      const paymentMode = String(body.paymentMode || "Cash").trim() || "Cash";
      const rentMonth =
        String(body.month || "").trim() || fmtMonthKey(joiningDate || new Date());

      const formPayload = {
        name: body.name,
        joiningDate,
        roomNo: body.roomNo,
        depositAmount: toNum(body.depositAmount),
        address: body.address,
        phoneNo: body.phoneNo ? String(body.phoneNo).trim() : "", // ✅ keep as string (safer)
        relativeAddress1: body.relativeAddress1,
        relativeAddress2: body.relativeAddress2,
        floorNo: body.floorNo,
        bedNo: body.bedNo,
        companyAddress: body.companyAddress,
        dateOfJoiningCollege: toDate(body.dateOfJoiningCollege),
        dob: toDate(body.dob),
        baseRent: toNum(body.baseRent),
        leaveDate: body.leaveDate || undefined,
        category: body.category || undefined,
      };

      const files = req.files || [];
      const relations = Array.isArray(body.relations)
        ? body.relations
        : body.relations
        ? [body.relations]
        : [];

      const docs = [];

      // ✅ ImageKit enabled?
      const canUseImagekit =
        !!process.env.IMAGEKIT_PUBLIC_KEY &&
        !!process.env.IMAGEKIT_PRIVATE_KEY &&
        !!process.env.IMAGEKIT_URL_ENDPOINT;

      for (let i = 0; i < files.length; i++) {
        const f = files[i];

        // allow only images (skip pdf for now)
        if (!/^image\/(jpeg|png|webp|gif|bmp|tiff)/i.test(f.mimetype)) continue;

        const compressed = await compressUnder10KB(f.buffer);

        const relation = ["Self", "Father", "Mother", "Husband", "Sister", "Brother"].includes(
          relations[i]
        )
          ? relations[i]
          : "Self";

        const safeBaseName = (f.originalname || "doc").replace(/[^\w.\-]/g, "_");

        if (canUseImagekit) {
          const uploadRes = await imagekit.upload({
            file: compressed,
            fileName: `${Date.now()}_${safeBaseName}.webp`,
            folder: "/mutakegirlshostel/docs",
            useUniqueFileName: true,
          });

          docs.push({
            fileName: f.originalname,
            relation,
            fileId: uploadRes.fileId,
            contentType: "image/webp",
            size: compressed.length,
            url: uploadRes.url,
          });
        } else {
          // ✅ fallback (don’t fail saving tenant)
          docs.push({
            fileName: f.originalname,
            relation,
            fileId: null,
            contentType: "image/webp",
            size: compressed.length,
            url: null,
            note: "ImageKit not configured",
          });
        }
      }

      // ✅ Update existing draft
      if (formId) {
        const existing = await Form.findById(formId);
        if (!existing) {
          return res
            .status(404)
            .json({ ok: false, message: "Draft form not found" });
        }

        Object.assign(existing, formPayload);

        // ✅ PATCH existing rents so save doesn't fail if older rows are missing required fields
        existing.rents = (Array.isArray(existing.rents) ? existing.rents : []).map((r) => ({
          ...r,
          month: r.month || rentMonth,
          paymentMode: r.paymentMode || paymentMode,
        }));

        if (existing.rents.length === 0) {
          existing.rents = [
            {
              rentAmount,
              date: joiningDate || new Date(),
              month: rentMonth,
              paymentMode,
            },
          ];
        }

        if (docs.length) {
          existing.documents = [...(existing.documents || []), ...docs];
        }

        await existing.save();
        return res.json({
          ok: true,
          form: existing,
          mode: "updated",
          imagekit: canUseImagekit,
        });
      }

      // ✅ Create new tenant
      const counter = await Counter.findOneAndUpdate(
        { name: "form_srno" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      const srNo = counter.seq;

      const created = await Form.create({
        srNo,
        ...formPayload,
        rents: [
          {
            rentAmount,
            date: joiningDate || new Date(),
            month: rentMonth,
            paymentMode,
          },
        ],
        documents: docs,
      });

      return res.status(201).json({
        ok: true,
        form: created,
        mode: "created",
        imagekit: canUseImagekit,
      });
    } catch (e) {
      console.error("forms-with-docs error:", e);
      return res.status(400).json({ ok: false, message: e.message || "Failed" });
    }
  }
);

module.exports = router;
