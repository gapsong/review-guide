# Q1-Q3 measurement: gapsong/qpeft PR #8 (main...develop at 4369298)

Head 43692980963628ae56dc0c94955a0bde5261e56e, merge base 8bac6aa50669196e5792674385b1a6f73ad25092. Model claude-opus-5-5. Repo profile: the qpeft example from SPEC.md (measurements/qpeft-profile-from-spec.md).

## Result

| Check | Target | Strict reading | Generous reading |
|---|---|---|---|
| Q1 gold units tiered critical | all | 15/15 | 18/22 |
| Q2 critical units outside the gold list | at most 10 | 28 (0 weakened-test rule, 28 by Claude) | 25 (0 rule, 25 Claude) |
| Q3 time from opening the PR to the overview | at most 120 s | 70 s | |

Units: 314 (critical 43, check 145, skim 126). Python units that fell back to raw hunks: 1.
Pass 1: 46 s in Claude, 64441 tokens in, 5159 tokens out.
Pass 2: Pass 2 waits for you: 43 critical units (more than 25)..

## Gold list, unit by unit

| Area | File | Gold function | Unit | Tier | Claude's reason |
|---|---|---|---|---|---|
| Quantization formula and STE | qpeft/quant_schemes/reference.py | _codes_ste | ReferenceIntUniformScheme._codes_ste() | critical | Rounding order changed to round(w/s)+z; clamp after adding z, STE path must give official gradients. |
| Quantization formula and STE | qpeft/quant_schemes/reference.py | fake_quant (generous) | ReferenceIntUniformScheme.fake_quant() | skim | fake_quant body unchanged; its behavior changes via U21. |
| Quantization formula and STE | qpeft/quant_schemes/reference.py | quantize (generous) | ReferenceIntUniformScheme.quantize() | skim | quantize body unchanged; codes change via U21. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | _ste | _ste() | critical | STE now detaches value; forward must equal value exactly and gradient must not double-count (the 2x scale bug). |
| Quantization formula and STE | qpeft/quant_schemes/base.py | clamp_scale | _IntUniformScheme.clamp_scale() | critical | clamp_scale with STE gradient 1 is used by training, merge and dequant; mismatch breaks merged == trained. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | round_zero_point | _IntUniformScheme.round_zero_point() | critical | Zero-point rounded and clamped to [qmin,qmax] with STE; changes training grid versus old fractional z. |
| Packing and merge fold | qpeft/packing.py | pack_codes | pack_codes() | critical | GPTQ pack: carrying the high bits into the next word and wrapping the sign into int32 must be exact. |
| Packing and merge fold | qpeft/packing.py | unpack_codes | unpack_codes() | critical | Unpack must read the spilled bits from the next word; shift 0 gives '<< 32', which relies on the mask to stay correct. |
| Packing and merge fold | qpeft/packing.py | _offsets (generous) | _offsets() | critical | Bit offsets for the packing stream; 3-bit codes must cross word boundaries exactly as AutoGPTQ does. |
| Packing and merge fold | qpeft/quant_schemes/base.py | merge | _IntUniformScheme.merge() | critical | Merge now clamps s and rounds z before fold z - delta/s; delta cast to s.dtype may lose precision. |
| Packing and merge fold | qpeft/tuners/tuners_utils.py | QuantLinear.merge | QuantLinear.merge() | critical | Merge in compute_dtype, packs codes, NaN check before mutation; the saved artifact's numbers come from here. |
| tinygemm and code freezing | qpeft/kernels/tinygemm.py | tinygemm_zero | tinygemm_zero() | critical | Zero-point conversion z_f = (8 - z) * s: sign and offset must match tinygemm's (q - 8) * s + z_f. |
| tinygemm and code freezing | qpeft/kernels/tinygemm.py | TinyGemmLinear.__init__ | TinyGemmLinear.__init__() | critical | Rounds scale and z_f to bf16 and transposes scales_and_zeros to the kernel layout; a quiet layout or precision error. |
| tinygemm and code freezing | qpeft/tuners/tuners_utils.py | QuantLinear.freeze_codes | QuantLinear.freeze_codes() | critical | Codes quantized in compute_dtype then packed and weight dropped; dtype here decides codes that merge reuses. |
| Block-AP and trainer defaults | qpeft/block_ap.py | run_block_ap | run_block_ap() | critical | Block-AP core: fp targets built with quant disabled, fp32 cast and cast back, and q-chain vs fp-chain inputs. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _to_float32 (generous) | _to_float32() | check | Casts rotary cos/sin and masks to fp32; misses floating tensors nested inside lists or dicts. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _cast_params (generous) | _cast_params() | critical | Swaps p.data dtype in place; fp32 scale/zero_point masters must come back as fp32, and the optimizer holds references to them. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _norm_weights (generous) | _norm_weights() | check | Picks which norm weights Block-AP trains; the name filter must equal the official 'weight in name' filter. |
| Block-AP and trainer defaults | qpeft/trainer.py | QATTrainer.__init__ | QATTrainer.__init__() | critical | Bit-dependent lr defaults (2e-5 for 2-bit) and use_cache redirection; a wrong default trains silently worse. |
| Block-AP and trainer defaults | qpeft/trainer.py | QATTrainingArguments (generous) | class QATTrainingArguments | critical | Training defaults (lrs, warmup 0.03 as float steps, grad norm 0.3, batch sizes) must match the official scripts. |
| Block-AP and trainer defaults | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.forward | ZeroPointFoldLoRA.forward() | critical | Sum pooling changed to mean with casts to x.dtype; this changes the adapter's effective scale versus the QA-LoRA formula. |
| Block-AP and trainer defaults | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.folded_delta | ZeroPointFoldLoRA.folded_delta() | critical | folded_delta divides by group_size; must exactly match mean pooling or merge != trained. |

## Critical units outside the gold list (strict reading)

| File | Unit | Reason |
|---|---|---|
| qpeft/block_ap.py | _cast_params() | Swaps p.data dtype in place; fp32 scale/zero_point masters must come back as fp32, and the optimizer holds references to them. |
| qpeft/config.py | QuantTuningConfig.to_dict() | Serialized config format: enums and tuples flattened; every field must round-trip. |
| qpeft/config.py | QuantTuningConfig.from_dict() | Load drops trainable_params silently and rebuilds it from the defaults; strict refusal of unknown fields. |
| qpeft/kernels/tinygemm.py | pack_int4_pairs() | int4 nibble order (even column in the high nibble) must match what _convert_weight_to_int4pack expects. |
| qpeft/kernels/tinygemm.py | TinyGemmLinear.forward() | Forces the input to bf16 and casts the output back; the kernel's group-size argument must match the export. |
| qpeft/packing.py | _offsets() | Bit offsets for the packing stream; 3-bit codes must cross word boundaries exactly as AutoGPTQ does. |
| qpeft/peft_model.py | QuantModel.save_pretrained() | On-disk format: the state_dict with 'base.' prefixes plus the config; any fp weight left in the state_dict breaks invariant 3. |
| qpeft/peft_model.py | QuantModel.from_pretrained() | Strict load into skeleton buffers: load_state_dict copies values and casts them to each skeleton tensor's dtype, so a skeleton dtype that differs from the saved one would not error. |
| qpeft/quant_schemes/base.py | (outside functions) | SCALE_MIN/SCALE_MAX bounds 1e-4/1e4 must match official clamp_ste; wrong bounds silently change every scale. |
| qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.init_qparams() | RTN init drops clamp_min(1e-8) for clamp_scale and rounds z; changes the starting grid (fp32 vs official fp16). |
| qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.dequant() | dequant clamps s but deliberately leaves z unrounded; both choices must match merge and forward. |
| qpeft/trainer.py | class QATTrainingArguments | Training defaults (lrs, warmup 0.03 as float steps, grad norm 0.3, batch sizes) must match the official scripts. |
| qpeft/tuners/efficient_qat/config.py | class EfficientQATConfig | Config defaults bits=4, group_size=128 must match official argparse; changes every default run. |
| qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.__init__() | Adapter params now fp32 masters on the base device; dtype choice decides whether bf16 updates move. |
| qpeft/tuners/tuners_utils.py | QuantLinear.__init__() | scale/zero_point become fp32 masters via promote_types, compute_dtype recorded, and packing requires in*bits%32. |
| qpeft/tuners/tuners_utils.py | QuantLinear._init_qparams() | RTN init now runs on the weight cast to fp32; this changes init precision versus the official fp16. |
| qpeft/tuners/tuners_utils.py | QuantLinear.forward() | Forward casts params to input dtype; frozen path rounds z while merged path does not, and these must agree. |
| qpeft/tuners/tuners_utils.py | QuantLinear.to_merged_skeleton() | Load skeleton shape (in*bits//32, out) and dtype must match the saved state_dict format exactly. |
| qpeft/utils.py | _merge_tolerance() | New tolerance: half precision allows 1e-2 relative error, so verify_quant_model's merge==train check accepts much larger drift. |
| tests/test_custom_models.py | test_fp16_base_survives_injection_and_forward() | Changed assertion: scale/zero_point are now fp32 masters while training and cast back to fp16 at merge. |
| tests/test_packing.py | _autogptq_pack() | Oracle for the GPTQ layout: a transcription error in the 3-bit word-boundary carry would bless wrong packing. |
| tests/test_qat_trainer.py | test_train_save_load_is_consistent() | Trained save/load uses 1e-3 atol, not bit-exact like test_save_load; does the tolerance hide a load drift? |
| tests/test_save_load.py | test_roundtrip_is_bit_exact() | Save/load oracle: torch.equal with a differently seeded base must catch silent re-quantization. |
| tests/test_ste_gradients.py | test_fake_quant_gradients_match_the_official_ste_formula() | Hand-written STE gradients for s, z, w now replace the official benchmark; a wrong oracle would hide formula bugs. |
| tests/test_ste_gradients.py | test_fp16_codes_round_before_adding_the_zero_point() | Pins the fp16 rounding order round(w/s)+z against the official code; the oracle must match OpenGVLab exactly. |
| tests/test_tinygemm.py | test_tinygemm_zero_gives_the_same_weight() | Pins z_f=(8-z)*s against (q-z)*s at 1e-12 in float64, including fractional folded z. |
| tests/test_tinygemm_real_model.py | (outside functions) | Sets the tolerances LOGITS_REL_ERR 3e-2, PPL 5e-3 and GREEDY_TIE_MARGIN 0.5; loose values would hide kernel errors. |
| tests/test_tinygemm_real_model.py | test_greedy_generation_matches_the_merged_model() | Allows greedy divergence at near-ties; confirm the escape hatch cannot pass a real kernel error. |

## What this PR does (Claude's summary)

This PR merges the develop stack into main. It adds a QATTrainer (Block-AP, then frozen codes, then E2E-QP), a standalone run_block_ap loop, per-kind optimizer groups, and save/load of a merged QuantModel. The frozen and merged integer codes are now stored packed in the GPTQ qweight layout. The PR also changes the quantizer's STE and rounding order to match the official EfficientQAT code, and adds a CUDA tinygemm export for merged 4-bit models. Schemes move into a quant_schemes package, and README, specs and examples are updated to match.

## All units

| Tier | File | Unit | Reason | Worth having? |
|---|---|---|---|---|
| critical | qpeft/block_ap.py | _cast_params() | Swaps p.data dtype in place; fp32 scale/zero_point masters must come back as fp32, and the optimizer holds references to them. |  |
| critical | qpeft/block_ap.py | run_block_ap() | Block-AP core: fp targets built with quant disabled, fp32 cast and cast back, and q-chain vs fp-chain inputs. |  |
| critical | qpeft/config.py | QuantTuningConfig.to_dict() | Serialized config format: enums and tuples flattened; every field must round-trip. |  |
| critical | qpeft/config.py | QuantTuningConfig.from_dict() | Load drops trainable_params silently and rebuilds it from the defaults; strict refusal of unknown fields. |  |
| critical | qpeft/kernels/tinygemm.py | tinygemm_zero() | Zero-point conversion z_f = (8 - z) * s: sign and offset must match tinygemm's (q - 8) * s + z_f. |  |
| critical | qpeft/kernels/tinygemm.py | pack_int4_pairs() | int4 nibble order (even column in the high nibble) must match what _convert_weight_to_int4pack expects. |  |
| critical | qpeft/kernels/tinygemm.py | TinyGemmLinear.__init__() | Rounds scale and z_f to bf16 and transposes scales_and_zeros to the kernel layout; a quiet layout or precision error. |  |
| critical | qpeft/kernels/tinygemm.py | TinyGemmLinear.forward() | Forces the input to bf16 and casts the output back; the kernel's group-size argument must match the export. |  |
| critical | qpeft/packing.py | _offsets() | Bit offsets for the packing stream; 3-bit codes must cross word boundaries exactly as AutoGPTQ does. |  |
| critical | qpeft/packing.py | pack_codes() | GPTQ pack: carrying the high bits into the next word and wrapping the sign into int32 must be exact. |  |
| critical | qpeft/packing.py | unpack_codes() | Unpack must read the spilled bits from the next word; shift 0 gives '<< 32', which relies on the mask to stay correct. |  |
| critical | qpeft/peft_model.py | QuantModel.save_pretrained() | On-disk format: the state_dict with 'base.' prefixes plus the config; any fp weight left in the state_dict breaks invariant 3. |  |
| critical | qpeft/peft_model.py | QuantModel.from_pretrained() | Strict load into skeleton buffers: load_state_dict copies values and casts them to each skeleton tensor's dtype, so a skeleton dtype that differs from the saved one would not error. |  |
| critical | qpeft/quant_schemes/base.py | (outside functions) | SCALE_MIN/SCALE_MAX bounds 1e-4/1e4 must match official clamp_ste; wrong bounds silently change every scale. |  |
| critical | qpeft/quant_schemes/base.py | _ste() | STE now detaches value; forward must equal value exactly and gradient must not double-count (the 2x scale bug). |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.clamp_scale() | clamp_scale with STE gradient 1 is used by training, merge and dequant; mismatch breaks merged == trained. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.round_zero_point() | Zero-point rounded and clamped to [qmin,qmax] with STE; changes training grid versus old fractional z. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.merge() | Merge now clamps s and rounds z before fold z - delta/s; delta cast to s.dtype may lose precision. |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.init_qparams() | RTN init drops clamp_min(1e-8) for clamp_scale and rounds z; changes the starting grid (fp32 vs official fp16). |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme._codes_ste() | Rounding order changed to round(w/s)+z; clamp after adding z, STE path must give official gradients. |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.dequant() | dequant clamps s but deliberately leaves z unrounded; both choices must match merge and forward. |  |
| critical | qpeft/trainer.py | class QATTrainingArguments | Training defaults (lrs, warmup 0.03 as float steps, grad norm 0.3, batch sizes) must match the official scripts. |  |
| critical | qpeft/trainer.py | QATTrainer.__init__() | Bit-dependent lr defaults (2e-5 for 2-bit) and use_cache redirection; a wrong default trains silently worse. |  |
| critical | qpeft/tuners/efficient_qat/config.py | class EfficientQATConfig | Config defaults bits=4, group_size=128 must match official argparse; changes every default run. |  |
| critical | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.__init__() | Adapter params now fp32 masters on the base device; dtype choice decides whether bf16 updates move. |  |
| critical | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.forward() | Sum pooling changed to mean with casts to x.dtype; this changes the adapter's effective scale versus the QA-LoRA formula. |  |
| critical | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.folded_delta() | folded_delta divides by group_size; must exactly match mean pooling or merge != trained. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.__init__() | scale/zero_point become fp32 masters via promote_types, compute_dtype recorded, and packing requires in*bits%32. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear._init_qparams() | RTN init now runs on the weight cast to fp32; this changes init precision versus the official fp16. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.forward() | Forward casts params to input dtype; frozen path rounds z while merged path does not, and these must agree. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.freeze_codes() | Codes quantized in compute_dtype then packed and weight dropped; dtype here decides codes that merge reuses. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.merge() | Merge in compute_dtype, packs codes, NaN check before mutation; the saved artifact's numbers come from here. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.to_merged_skeleton() | Load skeleton shape (in*bits//32, out) and dtype must match the saved state_dict format exactly. |  |
| critical | qpeft/utils.py | _merge_tolerance() | New tolerance: half precision allows 1e-2 relative error, so verify_quant_model's merge==train check accepts much larger drift. |  |
| critical | tests/test_custom_models.py | test_fp16_base_survives_injection_and_forward() | Changed assertion: scale/zero_point are now fp32 masters while training and cast back to fp16 at merge. |  |
| critical | tests/test_packing.py | _autogptq_pack() | Oracle for the GPTQ layout: a transcription error in the 3-bit word-boundary carry would bless wrong packing. |  |
| critical | tests/test_qat_trainer.py | test_train_save_load_is_consistent() | Trained save/load uses 1e-3 atol, not bit-exact like test_save_load; does the tolerance hide a load drift? |  |
| critical | tests/test_save_load.py | test_roundtrip_is_bit_exact() | Save/load oracle: torch.equal with a differently seeded base must catch silent re-quantization. |  |
| critical | tests/test_ste_gradients.py | test_fake_quant_gradients_match_the_official_ste_formula() | Hand-written STE gradients for s, z, w now replace the official benchmark; a wrong oracle would hide formula bugs. |  |
| critical | tests/test_ste_gradients.py | test_fp16_codes_round_before_adding_the_zero_point() | Pins the fp16 rounding order round(w/s)+z against the official code; the oracle must match OpenGVLab exactly. |  |
| critical | tests/test_tinygemm.py | test_tinygemm_zero_gives_the_same_weight() | Pins z_f=(8-z)*s against (q-z)*s at 1e-12 in float64, including fractional folded z. |  |
| critical | tests/test_tinygemm_real_model.py | (outside functions) | Sets the tolerances LOGITS_REL_ERR 3e-2, PPL 5e-3 and GREEDY_TIE_MARGIN 0.5; loose values would hide kernel errors. |  |
| critical | tests/test_tinygemm_real_model.py | test_greedy_generation_matches_the_merged_model() | Allows greedy divergence at near-ties; confirm the escape hatch cannot pass a real kernel error. |  |
| check | examples/train_efficient_qat.py | main() | Example asserts the codes stay frozen and the weight is dropped; a wrong assertion here would hide a phase-switch bug. |  |
| check | pyproject.toml | lines 10-11 | New train and dev dependencies; transformers is pinned to <6 because trainer.py uses Trainer internals. |  |
| check | qpeft/__init__.py | __getattr__() | Lazy __getattr__ for the trainer: an ImportError raised inside trainer.py itself gets reported as 'install transformers'. |  |
| check | qpeft/block_ap.py | find_blocks() | Longest-ModuleList heuristic could pick the wrong list on non-standard architectures. |  |
| check | qpeft/block_ap.py | _to_float32() | Casts rotary cos/sin and masks to fp32; misses floating tensors nested inside lists or dicts. |  |
| check | qpeft/block_ap.py | _norm_weights() | Picks which norm weights Block-AP trains; the name filter must equal the official 'weight in name' filter. |  |
| check | qpeft/block_ap.py | _capture_block_inputs() | Captures block inputs through a hook; kwargs like the attention mask or position embeddings could be missed. |  |
| check | qpeft/block_ap.py | _cosine() | Cosine floor at lr/min_lr_factor should match the official schedule; covered by a dedicated test. |  |
| check | qpeft/config.py | QuantTuningConfig.save_pretrained() | Plain JSON write of the config. |  |
| check | qpeft/config.py | QuantTuningConfig.from_pretrained() | Plain JSON read, dispatching to from_dict. |  |
| check | qpeft/kernels/tinygemm.py | _inner_k_tiles() | Picks inner_k_tiles; a wrong tile choice would fail loudly in the kernel. |  |
| check | qpeft/kernels/tinygemm.py | check_supported() | Refusal gates; the torch version parse could break on unusual version strings. |  |
| check | qpeft/kernels/tinygemm.py | to_tinygemm() | Replaces layers in place after checking all of them; parent lookup by name. |  |
| check | qpeft/peft_model.py | QuantModel.__init__() | Unwraps a QuantModel for the phase switch, so the tuner re-enters existing QuantLinears; PEQA now fails with a clear error. |  |
| check | qpeft/peft_model.py | QuantModel.gradient_checkpointing_enable() | Forwards gradient-checkpointing kwargs to the HF model; refuses models without it. |  |
| check | qpeft/peft_model.py | QuantModel.gradient_checkpointing_disable() | Disable is a silent no-op when the base lacks the method. |  |
| check | qpeft/peft_model.py | QuantModel.is_merged() | Gates save: an empty model or partly merged layers must count as not merged. |  |
| check | qpeft/peft_model.py | QuantModel.set_phase() | Phase switch delegates to apply_config (the critical code is elsewhere); it also replaces self.config. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.init_qparams() | torchao init now clamps s and rounds zp through the shared helpers; must match reference init. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.fake_quant() | torchao fake_quant switches to the clamp/round helpers; gradient path to z now STE instead of plain round. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.quantize() | torchao quantize uses the clamped scale; codes must agree with the reference backend. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.dequant() | torchao dequant clamps s and keeps z fractional, like the reference. |  |
| check | qpeft/trainer.py | _block_linear_names() | Picks the largest ModuleList as the blocks; could pick the wrong list or miss linears on odd architectures. |  |
| check | qpeft/trainer.py | _prepare_model() | Model validation and refusals; a missed case would fail loudly later. |  |
| check | qpeft/trainer.py | _GuardCallback.__init__() | Guard state init; logic is covered in the other callback units. |  |
| check | qpeft/trainer.py | _GuardCallback.on_train_begin() | Snapshot clones every trainable param, which doubles memory on large models. |  |
| check | qpeft/trainer.py | _GuardCallback.on_step_begin() | Checks lr>0 before the step; a scheduler-order assumption that could skip or misfire the guard. |  |
| check | qpeft/trainer.py | _GuardCallback.on_step_end() | Raises if no param moved; a false positive would stop valid runs loudly. |  |
| check | qpeft/trainer.py | _GuardCallback.on_train_end() | Raises at train end if no lr>0 step happened; could trip on very short runs. |  |
| check | qpeft/trainer.py | QATTrainer._set_signature_columns_if_needed() | Signature columns taken from base.forward; a wrong list silently drops dataset columns. |  |
| check | qpeft/trainer.py | QATTrainer.create_optimizer() | Picks e2e_lr vs quant_lr by phase and hard-codes adapter_lr=0; this wiring decides which lr the scales get. |  |
| check | qpeft/trainer.py | QATTrainer.compute_loss() | Raises on zero or non-finite loss; .item() forces a sync every step. |  |
| check | qpeft/trainer.py | QATTrainer._block_ap_batches() | Row counting and truncation for Block-AP calibration; an off-by-one silently changes the sample count. |  |
| check | qpeft/trainer.py | QATTrainer.train() | Phase hand-over, then optimizer reset before E2E-QP; a stale optimizer would train the wrong set. |  |
| check | qpeft/trainer.py | QATTrainer.save_model() | Merges on every process, writes only where should_save; merge is irreversible even when not saving. |  |
| check | qpeft/trainer.py | QATTrainer.push_to_hub() | Refuses push_to_hub at runtime; this duplicates the args check. |  |
| check | qpeft/training.py | param_groups() | Group assignment per kind and stray-param refusal; a param in the wrong group gets the wrong lr. |  |
| check | qpeft/tuners/qa_lora/layer.py | dispatch_default() | Passes the device through to the adapter. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.codes() | Unpacks qweight via packing helper; the helper is the critical part. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.apply_config() | Phase switch refuses representation changes and unfreezing; a missed field would fail loudly or diverge. |  |
| check | qpeft/tuners/tuners_utils.py | BaseQuantTuner.inject_adapters() | Re-injection now switches phase on existing layers instead of skipping them. |  |
| check | qpeft/tuners/tuners_utils.py | BaseQuantTuner._freeze_non_quant_params() | Freezes every non-QuantLinear param; Block-AP norms must be re-enabled explicitly elsewhere. |  |
| check | qpeft/utils.py | check_layer_merge_equivalence() | Deepcopy and merge a layer; is x built with the right in_features and dtype for frozen and packed layers? |  |
| check | qpeft/utils.py | verify_quant_model() | Skips merged layers silently (returns 0.0); a fully merged model looks verified. |  |
| check | tests/test_block_ap.py | test_every_block_reconstructs_better_after_training() | Asserts per-block MSE improves; relies on log parsing matching block count. |  |
| check | tests/test_block_ap.py | test_only_block_weights_qparams_and_norms_change() | Only the '.weight' suffix is checked, so any block weight passes, not just the linear or norm ones. |  |
| check | tests/test_block_ap.py | test_dtypes_and_train_mode_are_restored() | Checks that bf16 dtypes, requires_grad and train mode come back after Block-AP. |  |
| check | tests/test_block_ap.py | test_refuses_a_model_that_is_not_in_block_ap_phase() | Refusal test for the wrong phase. |  |
| check | tests/test_block_ap.py | test_refuses_without_calibration_batches() | Refusal test when there are no calibration batches. |  |
| check | tests/test_block_ap.py | test_cosine_goes_from_lr_down_to_lr_over_min_lr_factor() | Pins the cosine LR floor and clamp; do the expected values match the official schedule? |  |
| check | tests/test_config.py | test_efficient_qat_defaults_match_official_code() | Pins the default bits and group_size to the official 4/128; the default itself is in config. |  |
| check | tests/test_config.py | test_config_roundtrips_through_dict_and_disk() | Config round trip through dict and disk. |  |
| check | tests/test_config.py | test_config_from_dict_refuses_an_unknown_field() | Strict load refuses unknown fields. |  |
| check | tests/test_config.py | test_config_from_dict_refuses_a_different_method() | Refuses loading a config written by a different method. |  |
| check | tests/test_custom_models.py | test_scale_only_training_keeps_codes_frozen() | Now compares the unpacked codes property instead of the raw buffer; could this hide a packing bug? |  |
| check | tests/test_custom_models.py | test_trainable_weight_has_no_frozen_codes() | Replaced assertion now checks codes_frozen and that weight is present, not a frozen_codes buffer. |  |
| check | tests/test_efficient_qat_phases.py | _assert_only_allowed_changed() | Core helper: skips None entries, so a missing qweight or weight goes unchecked. |  |
| check | tests/test_efficient_qat_phases.py | test_requires_grad_matches_phase() | requires_grad per phase, and weight is None in E2E-QP. |  |
| check | tests/test_efficient_qat_phases.py | test_training_changes_only_allowed_params() | Only the allowed params change during training in each phase. |  |
| check | tests/test_efficient_qat_phases.py | test_e2e_qp_codes_are_frozen_when_scale_moves() | Frozen codes are used after the scale moves; tight 1e-6 tolerance. |  |
| check | tests/test_efficient_qat_phases.py | test_schedule_switches_trainable_set_and_keeps_phase1_results() | Phase switch must keep the Block-AP qparams and freeze codes equal to quantize(w, s, z). |  |
| check | tests/test_examples.py | test_example_runs() | Runs the example scripts as tests. |  |
| check | tests/test_examples.py | test_hf_injection_example_runs() | Runs the HF injection example; skipped without transformers. |  |
| check | tests/test_examples.py | test_qat_trainer_example_runs() | New test that is skipped unless QPEFT_RUN_SLOW is set, so it rarely runs in CI. |  |
| check | tests/test_examples.py | test_every_example_is_covered() | Guard that every example has a test. |  |
| check | tests/test_merged_format.py | _assert_merged_format() | Pins the merged artifact format: qweight shape, code range, dtypes, state_dict keys. |  |
| check | tests/test_merged_format.py | test_merge_layers_fp32() | Merge equivalence at 1e-4 for 2/3/4/8 bits across methods. |  |
| check | tests/test_merged_format.py | test_merge_layers_fp16() | fp16 merge compared at 1e-2 atol/rtol and not trained, so it is a weak equivalence check. |  |
| check | tests/test_merged_format.py | test_non_target_layers_untouched() | Non-target head stays an untouched nn.Linear. |  |
| check | tests/test_merged_format.py | test_merge_is_idempotent() | A second merge must not change outputs or the state. |  |
| check | tests/test_merged_format.py | test_merge_with_nan_adapter_refuses_and_leaves_layer_untouched() | A NaN adapter must be refused, leaving the layer untouched. |  |
| check | tests/test_merged_format.py | test_save_load_every_key_equal() | Save/load keeps every key's dtype and value bit-exact. |  |
| check | tests/test_packing.py | test_pack_matches_autogptq() | pack_codes vs the AutoGPTQ oracle for 2/3/4/8 bits. |  |
| check | tests/test_packing.py | test_unpack_inverts_pack() | Unpack inverts pack for 1-8 bits and checks the packed shape. |  |
| check | tests/test_packing.py | test_extreme_codes_survive_the_sign_bit() | Sign bit in the int32 words: arithmetic vs logical shift on unpack. |  |
| check | tests/test_packing.py | test_refuses_what_does_not_fill_whole_words() | Refuses a partial word and out-of-range codes. |  |
| check | tests/test_packing.py | test_layer_refuses_shapes_that_cannot_be_packed() | Layer build refuses shapes that cannot be packed. |  |
| check | tests/test_packing.py | test_merged_codes_take_bits_per_weight() | Merged storage is bits per weight and zero-points stay float. |  |
| check | tests/test_precision.py | test_block_ap_in_bf16_moves_weights_and_keeps_dtypes() | Regression test: bf16 weights must move at the official LR, and the fp32 masters are kept. |  |
| check | tests/test_precision.py | test_block_ap_trains_norms_and_reduces_the_mean_reconstruction_error() | Norms train, and the log parsing via rsplit is fragile. |  |
| check | tests/test_precision.py | test_e2e_qp_in_bf16_moves_the_scale() | E2E-QP scale moves in bf16 at LR 2e-5. |  |
| check | tests/test_precision.py | test_qa_lora_adapter_is_fp32_and_moves_in_a_bf16_model() | QA-LoRA adapter is fp32 in a bf16 model and moves. |  |
| check | tests/test_precision.py | test_zero_point_is_an_integer_in_training_and_in_the_artifact() | Drifted zero-point is rounded and clamped in [0, qmax], and merge equals fake_quant exactly. |  |
| check | tests/test_qa_lora_real_model.py | (outside functions) | Sets LOGITS_ATOL 1e-3 and LOSS_RTOL 1e-5 for the whole-model merge check. |  |
| check | tests/test_qa_lora_real_model.py | _real_model() | Any load exception becomes a silent skip, which could hide a real failure. |  |
| check | tests/test_qa_lora_real_model.py | _oracle_codes() | Oracle RTN codes are computed with the scheme under test, so they are not fully independent. |  |
| check | tests/test_qa_lora_real_model.py | test_qa_lora_train_then_merge_is_lossless() | End to end: codes are bit-exact to the oracle, the scale is unchanged, logits match within atol. |  |
| check | tests/test_qat_trainer.py | _args() | Test args override warmup and accumulation; confirm this does not hide the official-default schedule path. |  |
| check | tests/test_qat_trainer.py | _snap() | Snapshot recomputes codes via quantize when unfrozen; a wrong branch would make the phase assertions vacuous. |  |
| check | tests/test_qat_trainer.py | test_accepts_plain_hf_model_and_targets_block_linears() | Pins that lm_head stays fp and only block linears are quantized. |  |
| check | tests/test_qat_trainer.py | test_default_config_is_paper_default() | Pins the default config at bits 4 / group 128, the paper default. |  |
| check | tests/test_qat_trainer.py | test_refuses_qa_lora_config() | Refusal of a QA-LoRA config in the EfficientQAT trainer. |  |
| check | tests/test_qat_trainer.py | test_refuses_qa_lora_quant_model() | Refusal of a QA-LoRA QuantModel passed directly. |  |
| check | tests/test_qat_trainer.py | test_refuses_targets_that_match_nothing() | Empty target match must raise, not train nothing. |  |
| check | tests/test_qat_trainer.py | test_refuses_merged_model() | A merged model must not be trained again. |  |
| check | tests/test_qat_trainer.py | test_refuses_mid_training_checkpoints() | Mid-training checkpoints refused; only the exception type is checked. |  |
| check | tests/test_qat_trainer.py | test_runs_both_phases_with_the_right_trainable_sets() | Spy on Trainer.train pins the hand-over: codes frozen, weight dropped, only scale trainable in E2E-QP. |  |
| check | tests/test_qat_trainer.py | test_bit_dependent_defaults_resolve() | Pins the 2-bit learning-rate defaults (2e-5, 2e-5, 1e-4); compare them with the official EfficientQAT scripts. |  |
| check | tests/test_qat_trainer.py | test_zero_learning_rate_is_caught() | Guard for lr 0 aborts; only RuntimeError type is matched, which could come from anything. |  |
| check | tests/test_qat_trainer.py | test_accepts_efficient_qat_quant_model_as_is() | An EfficientQAT QuantModel is used as-is without re-wrapping. |  |
| check | tests/test_qat_trainer.py | test_refuses_quant_model_plus_quant_config() | Double configuration refused with a message match. |  |
| check | tests/test_qat_trainer.py | test_e2e_qp_optimizer_trains_only_the_scales_at_e2e_lr() | E2E-QP optimizer has exactly one group of scales at e2e_lr, not quant_lr. |  |
| check | tests/test_qat_trainer.py | test_block_ap_hands_over_to_an_e2e_qp_optimizer() | After Block-AP the optimizer is rebuilt at e2e_lr over scales only. |  |
| check | tests/test_qat_trainer.py | test_zero_loss_is_caught() | Zero-loss guard is checked by monkeypatching the parent compute_loss. |  |
| check | tests/test_qat_trainer.py | test_block_ap_batches_hold_exactly_block_ap_train_size_rows() | Regression test for the short-batch row-counting fix; the batch and train sizes exercise the uneven tail. |  |
| check | tests/test_qat_trainer.py | test_gradient_checkpointing_trains_both_phases() | Gradient checkpointing across both phases; only asserts the flag, not that training ran correctly. |  |
| check | tests/test_qat_trainer.py | test_gradient_checkpointing_is_refused_for_a_model_without_it() | A model without checkpointing support is refused. |  |
| check | tests/test_qat_trainer.py | test_use_cache_goes_to_the_hf_model_not_the_qpeft_config() | use_cache lands on the HF config, not the qpeft config that gets serialized. |  |
| check | tests/test_qat_trainer.py | test_push_to_hub_is_refused_with_a_pointer_to_save_model() | push_to_hub and internal saves refused before the model gets merged. |  |
| check | tests/test_qat_trainer.py | test_save_model_merges_everywhere_but_writes_only_on_the_main_process() | Non-main ranks merge but write nothing; should_save is monkeypatched at the class level. |  |
| check | tests/test_qat_trainer.py | test_star_import_works_without_transformers() | Star import without transformers runs in a subprocess. |  |
| check | tests/test_qat_trainer.py | test_refuses_push_to_hub_argument() | push_to_hub=True refused at construction. |  |
| check | tests/test_save_load.py | _merged() | Randomizes adapter B so the zero-point fold is non-trivial; without it the round-trip tests are weak. |  |
| check | tests/test_save_load.py | test_merge_drops_float_weight() | Merged layers keep no float weight in the state_dict. |  |
| check | tests/test_save_load.py | test_loaded_model_is_merged_integer_and_frozen() | Loaded layers are merged, int32, adapter-free and frozen. |  |
| check | tests/test_save_load.py | test_saving_unmerged_model_refuses() | Saving an unmerged model is refused. |  |
| check | tests/test_save_load.py | test_unknown_contract_in_saved_config_refuses() | Unknown backend or scheme in a saved config must refuse, not fall back. |  |
| check | tests/test_save_load.py | test_torchao_backend_without_torchao_refuses() | Missing torchao is simulated through sys.modules; check that the simulation really blocks the import. |  |
| check | tests/test_save_load.py | test_shape_mismatch_refuses_instead_of_partial_load() | A shape mismatch must refuse instead of partially loading. |  |
| check | tests/test_save_load.py | test_fp16_dtypes_survive_roundtrip() | fp16 scale, zero_point and bias dtypes survive the round trip. |  |
| check | tests/test_ste_gradients.py | test_clamp_scale_passes_gradient_one() | Pins clamp_scale gradient 1 even outside the bounds; must match the official clamp_ste. |  |
| check | tests/test_ste_gradients.py | test_round_zero_point_passes_gradient_one() | Pins the zero-point round STE gradient at 1. |  |
| check | tests/test_tinygemm.py | _merged() | Randomizes adapter B before merge so the tinygemm tests see fractional zero-points. |  |
| check | tests/test_tinygemm.py | test_int4_pairs_hold_even_columns_in_the_high_nibble() | int4 pair packing: even columns go in the high nibble, as the tinygemm layout expects. |  |
| check | tests/test_tinygemm.py | test_refuses_an_unmerged_layer() | An unmerged layer is refused for export. |  |
| check | tests/test_tinygemm.py | test_refuses_what_the_kernel_cannot_run() | 3-bit and group-size-16 layers are refused. |  |
| check | tests/test_tinygemm.py | test_refuses_out_features_off_the_kernel_tiles() | out_features that are not a multiple of 8 are refused. |  |
| check | tests/test_tinygemm.py | test_to_tinygemm_changes_nothing_when_one_layer_is_refused() | Refusal is atomic: no layer is replaced before the error. |  |
| check | tests/test_tinygemm.py | test_refuses_without_cuda() | The no-CUDA refusal only runs on CPU machines. |  |
| check | tests/test_tinygemm.py | test_kernel_matches_the_merged_layer() | 1e-2 relative tolerance between kernel and merged layer; the negative control U67 backs it. |  |
| check | tests/test_tinygemm.py | test_wrong_zero_point_is_caught() | Negative control: an unconverted zero-point must exceed 1e-1 error. |  |
| check | tests/test_tinygemm_real_model.py | setup() | Short QA-LoRA training asserts non-zero adapters; broad except turns load failures into skips. |  |
| check | tests/test_tinygemm_real_model.py | test_every_target_runs_on_the_kernel() | Every target layer is replaced by TinyGemmLinear. |  |
| check | tests/test_tinygemm_real_model.py | test_logits_match_the_merged_model() | Logits and argmax agreement are checked against the U68 tolerances. |  |
| check | tests/test_tinygemm_real_model.py | test_perplexity_matches_the_merged_model() | Perplexity must match within PPL_RTOL. |  |
| check | tests/test_tinygemm_real_model.py | _next_token_margin() | Margin from the merged model at the divergence point; decides whether U79 passes. |  |
| check | tests/test_tinygemm_real_model.py | test_saved_and_loaded_model_runs_the_same_kernel() | save→load→to_tinygemm must be bit-identical to the in-memory export. |  |
| check | tests/test_training.py | test_block_ap_groups_weights_and_qparams_with_their_own_lr() | Block-AP puts weights at weight_lr and scale/zero_point at quant_lr. |  |
| check | tests/test_training.py | test_e2e_qp_groups_only_the_scale() | E2E-QP groups contain only scales. |  |
| check | tests/test_training.py | test_qa_lora_groups_only_the_adapter() | QA-LoRA groups contain only adapter params at adapter_lr. |  |
| check | tests/test_training.py | test_every_trainable_parameter_is_in_exactly_one_group() | No trainable param is missing from or duplicated across groups. |  |
| check | tests/test_training.py | test_extra_weights_join_the_weight_group() | Norm weights join the weight group, as in the official code. |  |
| check | tests/test_training.py | test_trainable_parameter_outside_quant_linear_refuses() | A stray trainable param outside QuantLinear is refused. |  |
| check | tests/test_training.py | test_nothing_trainable_refuses() | Nothing trainable is refused. |  |
| check | tests/test_training.py | test_weight_decay_reaches_every_group() | weight_decay reaches every group. |  |
| skim | .gitignore | lines 15-15 | Adds TASKS.md to .gitignore. |  |
| skim | CLAUDE.md | (outside functions) | CLAUDE.md trimmed; status and plans removed, one invariant line added. |  |
| skim | README.md | (outside functions) | README is stale: line 97 says qweight is 'not bit-packed yet', Status says 'no exporter is built'. |  |
| skim | docs/DESIGN.md | (outside functions) | Path update in DESIGN.md after the schemes moved. |  |
| skim | docs/specs/qat_trainer.md | (outside functions) | Spec doc; its default table should match QATTrainingArguments, which is in another part. |  |
| skim | docs/specs/save_load.md | (outside functions) | Spec doc describing the save format and its refusals. |  |
| skim | examples/README.md | (outside functions) | examples README wording. |  |
| skim | examples/qat_trainer.py | lines 1-37 | New example script; covered by test_examples behind the slow flag. |  |
| skim | examples/quickstart.py | (outside functions) | Docstring only. |  |
| skim | examples/quickstart.py | demo() | Quickstart now reuses one model across phases, showing the phase-switch path. |  |
| skim | examples/train_efficient_qat.py | (outside functions) | Docstring and imports. |  |
| skim | examples/train_efficient_qat.py | check_equivalence() | Example now calls verify_quant_model instead of an inline loop. |  |
| skim | examples/train_qa_lora.py | (outside functions) | Import change. |  |
| skim | examples/train_qa_lora.py | main() | Example switched to verify_quant_model. |  |
| skim | qpeft/__init__.py | (outside functions) | Re-exports new public names. |  |
| skim | qpeft/block_ap.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/block_ap.py | class _StopForward | Sentinel exception. |  |
| skim | qpeft/block_ap.py | _first() | Trivial tuple unwrap. |  |
| skim | qpeft/block_ap.py | _detach() | Trivial recursive detach. |  |
| skim | qpeft/block_ap.py | _mean_mse() | Logged MSE metric only. |  |
| skim | qpeft/config.py | (outside functions) | Imports and the config file name constant. |  |
| skim | qpeft/config.py | class QuantTuningType | Comment removal. |  |
| skim | qpeft/config.py | class TrainableParams | Comment removal. |  |
| skim | qpeft/config.py | class QuantTuningConfig | Comments removed only; defaults unchanged. |  |
| skim | qpeft/kernels/__init__.py | (outside functions) | Package exports. |  |
| skim | qpeft/kernels/tinygemm.py | (outside functions) | Docstring and constants. |  |
| skim | qpeft/kernels/tinygemm.py | class TinyGemmLinear | Class shell. |  |
| skim | qpeft/mapping.py | (outside functions) | Registry renamed, comments added. |  |
| skim | qpeft/mapping.py | get_quant_model() | Lazy import to break a cycle. |  |
| skim | qpeft/packing.py | (outside functions) | Docstring and mask constant. |  |
| skim | qpeft/peft_model.py | (outside functions) | Imports and the weights file name. |  |
| skim | qpeft/peft_model.py | class QuantModel | Class layout and section comments. |  |
| skim | qpeft/peft_model.py | QuantModel.quant_layers() | Trivial list helper. |  |
| skim | qpeft/quant_schemes/__init__.py | (outside functions) | Package exports. |  |
| skim | qpeft/quant_schemes/base.py | class _IntUniformScheme | Blank lines only. |  |
| skim | qpeft/quant_schemes/base.py | class ReferenceIntUniformScheme | Class removed from base.py, moved to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme._expand() | Moved unchanged to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.init_qparams() | Moved to reference.py; the changed version is U20. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme._codes_ste() | Moved to reference.py; the changed version is U21. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.fake_quant() | Moved unchanged to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.quantize() | Moved unchanged to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.dequant() | Moved to reference.py; the changed version is U24. |  |
| skim | qpeft/quant_schemes/base.py | register_scheme() | Moved unchanged to registry.py. |  |
| skim | qpeft/quant_schemes/base.py | build_scheme() | Moved unchanged to registry.py. |  |
| skim | qpeft/quant_schemes/base.py | _int_uniform() | Moved to registry.py with only the import path changed. |  |
| skim | qpeft/quant_schemes/reference.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/quant_schemes/reference.py | class ReferenceIntUniformScheme | Docstring updated to the new rounding order and clamps. |  |
| skim | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme._expand() | _expand moved unchanged. |  |
| skim | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.fake_quant() | fake_quant body unchanged; its behavior changes via U21. |  |
| skim | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.quantize() | quantize body unchanged; codes change via U21. |  |
| skim | qpeft/quant_schemes/registry.py | (outside functions) | Registry module imports and comments, moved code. |  |
| skim | qpeft/quant_schemes/registry.py | register_scheme() | register_scheme moved unchanged. |  |
| skim | qpeft/quant_schemes/registry.py | build_scheme() | build_scheme moved unchanged. |  |
| skim | qpeft/quant_schemes/registry.py | _int_uniform() | Backend factory moved; only the torchao import path changed. |  |
| skim | qpeft/quant_schemes/torchao.py | (outside functions) | Import paths after the package move. |  |
| skim | qpeft/trainer.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/trainer.py | class _GuardCallback | Class shell and message of the guard callback. |  |
| skim | qpeft/trainer.py | class QATTrainer | Class outline, section comments and save message. |  |
| skim | qpeft/trainer.py | QATTrainer._log_setup() | Log print only. |  |
| skim | qpeft/training.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/tuners/efficient_qat/layer.py | (outside functions) | Import path only. |  |
| skim | qpeft/tuners/qa_lora/layer.py | (outside functions) | Import path only. |  |
| skim | qpeft/tuners/qa_lora/layer.py | class ZeroPointFoldLoRA | Docstring about average pooling. |  |
| skim | qpeft/tuners/tuners_utils.py | (outside functions) | Imports. |  |
| skim | qpeft/tuners/tuners_utils.py | class QuantLinear | Docstring on precision and packed storage. |  |
| skim | qpeft/tuners/tuners_utils.py | class BaseQuantTuner | Blank line. |  |
| skim | qpeft/utils.py | (outside functions) | Import path rename from schemes to quant_schemes. |  |
| skim | tests/test_block_ap.py | (outside functions) | Test imports and target list. |  |
| skim | tests/test_block_ap.py | _llama() | Tiny Llama factory for tests. |  |
| skim | tests/test_block_ap.py | _batches() | Random calibration batches helper. |  |
| skim | tests/test_block_ap.py | _qmodel() | Quant model factory helper. |  |
| skim | tests/test_block_ap.py | _run() | Runs Block-AP and collects log lines. |  |
| skim | tests/test_block_ap.py | _mse_pairs() | Parses MSE numbers from the log string; breaks loudly if the format changes. |  |
| skim | tests/test_config.py | (outside functions) | Import changes and a section comment. |  |
| skim | tests/test_efficient_qat_phases.py | (outside functions) | Docstring with the phase contract, plus the TRAINABLE table. |  |
| skim | tests/test_efficient_qat_phases.py | _task() | Synthetic regression task helper. |  |
| skim | tests/test_efficient_qat_phases.py | _base() | Base model helper. |  |
| skim | tests/test_efficient_qat_phases.py | _layers() | Collects QuantLinear layers and fails if there are none. |  |
| skim | tests/test_efficient_qat_phases.py | _snapshot() | Snapshot helper for parameters. |  |
| skim | tests/test_efficient_qat_phases.py | _train() | Small training loop helper. |  |
| skim | tests/test_efficient_qat_phases.py | _trainable() | Lists trainable parameter names. |  |
| skim | tests/test_examples.py | (outside functions) | Test module imports. |  |
| skim | tests/test_examples.py | _run() | runpy helper. |  |
| skim | tests/test_initialization.py | (outside functions) | Import path rename. |  |
| skim | tests/test_merge_equivalence.py | (outside functions) | Import path rename. |  |
| skim | tests/test_merged_format.py | (outside functions) | Docstring spelling out the merged format, plus the method table. |  |
| skim | tests/test_merged_format.py | _base() | Base model factory. |  |
| skim | tests/test_merged_format.py | _trained() | Training helper that perturbs adapters so the merge is non-trivial. |  |
| skim | tests/test_packing.py | (outside functions) | Test imports. |  |
| skim | tests/test_packing.py | _codes() | Random codes helper. |  |
| skim | tests/test_precision.py | (outside functions) | Docstring and imports. |  |
| skim | tests/test_precision.py | _llama_bf16() | bf16 Llama factory. |  |
| skim | tests/test_precision.py | _batches() | Batches helper. |  |
| skim | tests/test_precision.py | _norms() | Selects the norm parameters. |  |
| skim | tests/test_qa_lora_real_model.py | _tiny_llama() | Tiny Llama factory. |  |
| skim | tests/test_qa_lora_real_model.py | _loss() | Loss helper. |  |
| skim | tests/test_qa_lora_real_model.py | _train_adapters() | Adapter training loop. |  |
| skim | tests/test_qat_trainer.py | (outside functions) | Imports, importorskip and section headers only; no assertion logic. |  |
| skim | tests/test_qat_trainer.py | class _Data | Dataset class shell for the tiny test data. |  |
| skim | tests/test_qat_trainer.py | _Data.__init__() | Seeded random token ids; nothing to go wrong quietly. |  |
| skim | tests/test_qat_trainer.py | _Data.__len__() | Trivial __len__. |  |
| skim | tests/test_qat_trainer.py | _Data.__getitem__() | Labels equal input_ids, standard causal-LM setup. |  |
| skim | tests/test_qat_trainer.py | _collate() | Stack collate helper. |  |
| skim | tests/test_qat_trainer.py | _llama() | Tiny Llama factory; group 64 must divide 128/256, which it does. |  |
| skim | tests/test_qat_trainer.py | _trainer() | Trainer construction helper. |  |
| skim | tests/test_qat_trainer.py | _cfg() | 4-bit g64 config helper. |  |
| skim | tests/test_qat_trainer.py | _changed_kinds() | Set of changed tensor kinds by name suffix. |  |
| skim | tests/test_save_load.py | (outside functions) | Header, imports and config factories; the tests below carry the logic. |  |
| skim | tests/test_save_load.py | _base() | Seeded Sequential base factory. |  |
| skim | tests/test_save_load.py | _quant_layers() | Collects QuantLinear and asserts at least one. |  |
| skim | tests/test_ste_gradients.py | (outside functions) | Docstring and imports. |  |
| skim | tests/test_ste_gradients.py | _scheme() | Scheme factory helper. |  |
| skim | tests/test_tinygemm.py | (outside functions) | Imports, the CUDA skip marker and section headers. |  |
| skim | tests/test_tinygemm.py | _qalora() | QA-LoRA config helper. |  |
| skim | tests/test_tinygemm.py | _rel_err() | Relative-norm error helper. |  |
| skim | tests/test_tinygemm_real_model.py | _windows() | WikiText window tokenization. |  |
| skim | tests/test_tinygemm_real_model.py | _base() | fp32 model loader. |  |
| skim | tests/test_tinygemm_real_model.py | _logits() | No-grad logits helper. |  |
| skim | tests/test_tinygemm_real_model.py | _ppl() | Mean-loss perplexity helper. |  |
| skim | tests/test_tinygemm_real_model.py | _greedy() | Greedy generate helper. |  |
| skim | tests/test_torchao_backend.py | (outside functions) | Import path follows the move from schemes to quant_schemes. |  |
| skim | tests/test_training.py | (outside functions) | Docstring, imports and the LR constants. |  |
| skim | tests/test_training.py | _base() | Base model factory. |  |
| skim | tests/test_training.py | _layers() | QuantLinear collector. |  |
| skim | tests/test_training.py | _ids() | id-set helper. |  |
| skim | tests/test_training.py | _by_name() | Groups keyed by name. |  |

## Claude's draft .review-guide.md

```markdown
(none)
```
