# Q1-Q3 measurement: gapsong/qpeft PR #8 (main...develop at 4369298)

Head 43692980963628ae56dc0c94955a0bde5261e56e, merge base 8bac6aa50669196e5792674385b1a6f73ad25092. Model claude-opus-5-5. No .review-guide.md on main, so Claude used the general rules.

## Result

| Check | Target | Strict reading | Generous reading |
|---|---|---|---|
| Q1 gold units tiered critical | all | 12/15 | 13/22 |
| Q2 critical units outside the gold list | at most 10 | 12 (0 weakened-test rule, 12 by Claude) | 11 (0 rule, 11 Claude) |
| Q3 time from opening the PR to the overview | at most 120 s | 68 s | |

Units: 314 (critical 24, check 171, skim 119). Python units that fell back to raw hunks: 1.
Pass 1: 45 s in Claude, 64320 tokens in, 4994 tokens out.
Pass 2: 6 Claude calls, 751 s of Claude time in total, done 366 s after opening.

## Gold list, unit by unit

| Area | File | Gold function | Unit | Tier | Claude's reason |
|---|---|---|---|---|---|
| Quantization formula and STE | qpeft/quant_schemes/reference.py | _codes_ste | ReferenceIntUniformScheme._codes_ste() | critical | Code formula changed from round(w/s + z) to round(w/s) + z. The order changes fp16 codes at rounding boundaries. |
| Quantization formula and STE | qpeft/quant_schemes/reference.py | fake_quant (generous) | ReferenceIntUniformScheme.fake_quant() | check | fake_quant is unchanged but now gets the clamped and rounded se/ze from _codes_ste. |
| Quantization formula and STE | qpeft/quant_schemes/reference.py | quantize (generous) | ReferenceIntUniformScheme.quantize() | check | quantize goes through the new _codes_ste; the int32 cast is unchanged. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | _ste | _ste() | critical | The STE now detaches value. A wrong detach doubles or zeroes the scale gradient, and nothing errors. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | clamp_scale | _IntUniformScheme.clamp_scale() | critical | clamp_scale feeds every primitive and the merge. Wrong bounds or gradient pass-through would quietly skew training and the artifact. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | round_zero_point | _IntUniformScheme.round_zero_point() | critical | Rounds the zero-point with a clamp to [qmin, qmax] and an STE gradient. A range or gradient bug quietly shifts every dequantized weight. |
| Packing and merge fold | qpeft/packing.py | pack_codes | pack_codes() | critical | On-disk format: the carry into the next word and the int32 sign wrap must match the GPTQ bit layout exactly. |
| Packing and merge fold | qpeft/packing.py | unpack_codes | unpack_codes() | critical | Unpack must invert pack for 3-bit codes that cross a word boundary; a bug silently corrupts every frozen code. |
| Packing and merge fold | qpeft/packing.py | _offsets (generous) | _offsets() | check | Word and shift offsets; covered by the AutoGPTQ comparison test. |
| Packing and merge fold | qpeft/quant_schemes/base.py | merge | _IntUniformScheme.merge() | critical | Merge fold formula: z - delta/s now uses the clamped s and rounded z, plus a dtype cast. Does it still equal the training forward? |
| Packing and merge fold | qpeft/tuners/tuners_utils.py | QuantLinear.merge | QuantLinear.merge() | critical | Builds the artifact in the base dtype and packs it; the NaN check runs before mutation. A dtype or pack mismatch corrupts saved models. |
| tinygemm and code freezing | qpeft/kernels/tinygemm.py | tinygemm_zero | tinygemm_zero() | critical | Zero conversion z_f = (8 - z) * s must reproduce (q - z) * s exactly under tinygemm's convention. |
| tinygemm and code freezing | qpeft/kernels/tinygemm.py | TinyGemmLinear.__init__ | TinyGemmLinear.__init__() | critical | scales_and_zeros stack/transpose layout and the bf16 rounding of s and z_f decide the exported weights. |
| tinygemm and code freezing | qpeft/tuners/tuners_utils.py | QuantLinear.freeze_codes | QuantLinear.freeze_codes() | check | Freezes codes in compute_dtype and drops the weight; the dtype must match the later merge. |
| Block-AP and trainer defaults | qpeft/block_ap.py | run_block_ap | run_block_ap() | critical | Block-AP core: fp targets with quant disabled, fp32 cast and cast-back, q-input vs fp-target chain; errors silently degrade the model. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _to_float32 (generous) | _to_float32() | check | Only tuples are cast to fp32; a list or dict kwarg (e.g. a cache) would stay in bf16. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _cast_params (generous) | _cast_params() | check | Reassigning p.data changes dtype in place; AdamW state and aliased parameters must not keep stale references. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _norm_weights (generous) | _norm_weights() | check | Name filter decides which norms train; a bias or embedding named 'weight' could slip in. |
| Block-AP and trainer defaults | qpeft/trainer.py | QATTrainer.__init__ | QATTrainer.__init__() | check | Resolves the bit-dependent lrs and moves use_cache to the HF config. The loss-kwargs inference affects gradient accumulation scaling. |
| Block-AP and trainer defaults | qpeft/trainer.py | QATTrainingArguments (generous) | class QATTrainingArguments | critical | New public training defaults, e.g. warmup_steps=0.03 read as a ratio. Wrong values train silently with the wrong hyperparameters. |
| Block-AP and trainer defaults | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.forward | ZeroPointFoldLoRA.forward() | check | Sum pooling became mean pooling. It must stay consistent with folded_delta's 1/group_size. |
| Block-AP and trainer defaults | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.folded_delta | ZeroPointFoldLoRA.folded_delta() | critical | Fold delta now divides by group_size. If it mismatches the mean-pooled forward, the merged QA-LoRA is silently wrong. |

## Critical units outside the gold list (strict reading)

| File | Unit | Reason |
|---|---|---|
| qpeft/block_ap.py | _cosine() | Cosine LR formula: is the floor exactly lr/min_lr_factor at step total, and is total=0 handled? |
| qpeft/config.py | QuantTuningConfig.from_dict() | Loader silently drops trainable_params and trusts the constructor to rebuild it; a phase mismatch would load the wrong config. |
| qpeft/kernels/tinygemm.py | pack_int4_pairs() | Nibble order: the kernel expects the even column in the high nibble; a swap gives wrong weights with no error. |
| qpeft/peft_model.py | QuantModel.from_pretrained() | Load path: skeleton, strict load and weights_only; a wrong skeleton shape or dtype would give a model that differs from the one trained. |
| qpeft/trainer.py | class QATTrainingArguments | New public training defaults, e.g. warmup_steps=0.03 read as a ratio. Wrong values train silently with the wrong hyperparameters. |
| qpeft/tuners/efficient_qat/config.py | class EfficientQATConfig | Public config defaults bits=4, group_size=128. A changed default silently changes every model built with the default config. |
| qpeft/tuners/tuners_utils.py | QuantLinear.forward() | Forward casts params to the input dtype and rounds z for frozen codes. It must match fake_quant and merge exactly. |
| qpeft/utils.py | _merge_tolerance() | New tolerance formula: a 1e-2 relative bound in half precision may hide a real merge mismatch. |
| tests/test_custom_models.py | test_fp16_base_survives_injection_and_forward() | Changes an existing assertion: scale/zero_point were expected fp16, now fp32 masters; the fp16 expectation moves to after the merge. |
| tests/test_ste_gradients.py | test_fake_quant_gradients_match_the_official_ste_formula() | Hand-written oracle for the scale/zero/weight gradients; if these formulas are wrong, the 2x scale-gradient fix is judged wrongly. |
| tests/test_tinygemm_real_model.py | (outside functions) | Sets the scoreboard constants: logits tolerance 3e-2 against a measured ~1e-2, and a greedy tie margin of 0.5 against the measured 0.13. |
| tests/test_tinygemm_real_model.py | test_greedy_generation_matches_the_merged_model() | An escape hatch lets greedy outputs diverge; a wrong prefix or margin check would hide real kernel errors. |

## What this PR does (Claude's summary)

This PR merges the develop branch into main. It adds a QATTrainer for EfficientQAT that runs Block-AP, freezes the codes, then runs E2E-QP. It also adds a block-wise Block-AP loop, per-kind optimizer param groups, and save/load for merged QuantModels. The schemes move into a `quant_schemes` package, and the quantizer now matches the official EfficientQAT one (a detached STE value, and rounding before adding z). Frozen and merged codes are now stored packed in the GPTQ int32 layout, and a new tinygemm export lets merged 4-bit models run on PyTorch's CUDA int4 kernel.

## All units

| Tier | File | Unit | Reason | Worth having? |
|---|---|---|---|---|
| critical | qpeft/block_ap.py | _cosine() | Cosine LR formula: is the floor exactly lr/min_lr_factor at step total, and is total=0 handled? |  |
| critical | qpeft/block_ap.py | run_block_ap() | Block-AP core: fp targets with quant disabled, fp32 cast and cast-back, q-input vs fp-target chain; errors silently degrade the model. |  |
| critical | qpeft/config.py | QuantTuningConfig.from_dict() | Loader silently drops trainable_params and trusts the constructor to rebuild it; a phase mismatch would load the wrong config. |  |
| critical | qpeft/kernels/tinygemm.py | tinygemm_zero() | Zero conversion z_f = (8 - z) * s must reproduce (q - z) * s exactly under tinygemm's convention. |  |
| critical | qpeft/kernels/tinygemm.py | pack_int4_pairs() | Nibble order: the kernel expects the even column in the high nibble; a swap gives wrong weights with no error. |  |
| critical | qpeft/kernels/tinygemm.py | TinyGemmLinear.__init__() | scales_and_zeros stack/transpose layout and the bf16 rounding of s and z_f decide the exported weights. |  |
| critical | qpeft/packing.py | pack_codes() | On-disk format: the carry into the next word and the int32 sign wrap must match the GPTQ bit layout exactly. |  |
| critical | qpeft/packing.py | unpack_codes() | Unpack must invert pack for 3-bit codes that cross a word boundary; a bug silently corrupts every frozen code. |  |
| critical | qpeft/peft_model.py | QuantModel.from_pretrained() | Load path: skeleton, strict load and weights_only; a wrong skeleton shape or dtype would give a model that differs from the one trained. |  |
| critical | qpeft/quant_schemes/base.py | _ste() | The STE now detaches value. A wrong detach doubles or zeroes the scale gradient, and nothing errors. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.clamp_scale() | clamp_scale feeds every primitive and the merge. Wrong bounds or gradient pass-through would quietly skew training and the artifact. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.round_zero_point() | Rounds the zero-point with a clamp to [qmin, qmax] and an STE gradient. A range or gradient bug quietly shifts every dequantized weight. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.merge() | Merge fold formula: z - delta/s now uses the clamped s and rounded z, plus a dtype cast. Does it still equal the training forward? |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme._codes_ste() | Code formula changed from round(w/s + z) to round(w/s) + z. The order changes fp16 codes at rounding boundaries. |  |
| critical | qpeft/trainer.py | class QATTrainingArguments | New public training defaults, e.g. warmup_steps=0.03 read as a ratio. Wrong values train silently with the wrong hyperparameters. |  |
| critical | qpeft/tuners/efficient_qat/config.py | class EfficientQATConfig | Public config defaults bits=4, group_size=128. A changed default silently changes every model built with the default config. |  |
| critical | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.folded_delta() | Fold delta now divides by group_size. If it mismatches the mean-pooled forward, the merged QA-LoRA is silently wrong. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.forward() | Forward casts params to the input dtype and rounds z for frozen codes. It must match fake_quant and merge exactly. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.merge() | Builds the artifact in the base dtype and packs it; the NaN check runs before mutation. A dtype or pack mismatch corrupts saved models. |  |
| critical | qpeft/utils.py | _merge_tolerance() | New tolerance formula: a 1e-2 relative bound in half precision may hide a real merge mismatch. |  |
| critical | tests/test_custom_models.py | test_fp16_base_survives_injection_and_forward() | Changes an existing assertion: scale/zero_point were expected fp16, now fp32 masters; the fp16 expectation moves to after the merge. |  |
| critical | tests/test_ste_gradients.py | test_fake_quant_gradients_match_the_official_ste_formula() | Hand-written oracle for the scale/zero/weight gradients; if these formulas are wrong, the 2x scale-gradient fix is judged wrongly. |  |
| critical | tests/test_tinygemm_real_model.py | (outside functions) | Sets the scoreboard constants: logits tolerance 3e-2 against a measured ~1e-2, and a greedy tie margin of 0.5 against the measured 0.13. |  |
| critical | tests/test_tinygemm_real_model.py | test_greedy_generation_matches_the_merged_model() | An escape hatch lets greedy outputs diverge; a wrong prefix or margin check would hide real kernel errors. |  |
| check | examples/quickstart.py | demo() | Quickstart now chains phases on the same model instead of a fresh deepcopy, which changes what it demonstrates. |  |
| check | examples/train_efficient_qat.py | main() | Example asserts codes stay frozen and weight is dropped; a wrong assert would pass silently in docs. |  |
| check | pyproject.toml | lines 10-11 | New transformers <6 pin; trainer depends on Trainer internals, so version drift breaks it. |  |
| check | qpeft/__init__.py | (outside functions) | Public exports change; the import order of block_ap/training could create cycles. |  |
| check | qpeft/__init__.py | __getattr__() | Lazy __getattr__ could swallow a real ImportError inside trainer.py as 'needs transformers'. |  |
| check | qpeft/block_ap.py | find_blocks() | The longest ModuleList heuristic could pick the wrong list of blocks on an unusual architecture. |  |
| check | qpeft/block_ap.py | _to_float32() | Only tuples are cast to fp32; a list or dict kwarg (e.g. a cache) would stay in bf16. |  |
| check | qpeft/block_ap.py | _norm_weights() | Name filter decides which norms train; a bias or embedding named 'weight' could slip in. |  |
| check | qpeft/block_ap.py | _cast_params() | Reassigning p.data changes dtype in place; AdamW state and aliased parameters must not keep stale references. |  |
| check | qpeft/block_ap.py | _capture_block_inputs() | Hook captures the first block's args and kwargs; a missed kwarg (position_embeddings, mask) silently mis-trains every block. |  |
| check | qpeft/block_ap.py | _mean_mse() | Logged MSE only; wrong pairing would mislead but would not change weights. |  |
| check | qpeft/config.py | QuantTuningConfig.to_dict() | Serialization of enums and tuples; a missed nested type would break the JSON round trip loudly. |  |
| check | qpeft/kernels/tinygemm.py | _inner_k_tiles() | Picks the inner_k_tiles; a wrong choice would make the kernel fail loudly. |  |
| check | qpeft/kernels/tinygemm.py | check_supported() | Refusal gates; the torch version parse and CUDA check are guards, not math. |  |
| check | qpeft/kernels/tinygemm.py | TinyGemmLinear.forward() | Forward casts input to bf16 and back; the bias add order is plain. |  |
| check | qpeft/kernels/tinygemm.py | to_tinygemm() | Checks all layers before replacing; the submodule path split must find nested parents. |  |
| check | qpeft/mapping.py | get_quant_model() | Lazy import to break a cycle; the return type annotation is dropped. |  |
| check | qpeft/packing.py | _offsets() | Word and shift offsets; covered by the AutoGPTQ comparison test. |  |
| check | qpeft/peft_model.py | QuantModel.__init__() | Re-wrapping a QuantModel unwraps to base; the tuner must then switch phase, not re-inject layers. |  |
| check | qpeft/peft_model.py | QuantModel.gradient_checkpointing_enable() | Forwards checkpointing kwargs to the HF model; refuses loudly when missing. |  |
| check | qpeft/peft_model.py | QuantModel.gradient_checkpointing_disable() | Silent no-op when the base model lacks the method. |  |
| check | qpeft/peft_model.py | QuantModel.is_merged() | is_merged gates saving; a partially merged model must return False. |  |
| check | qpeft/peft_model.py | QuantModel.set_phase() | Phase switch delegates to apply_config; that is where the code freeze happens. |  |
| check | qpeft/peft_model.py | QuantModel.save_pretrained() | Saves the full state_dict; check that no fp weight or adapter leaks into the artifact. |  |
| check | qpeft/quant_schemes/base.py | (outside functions) | Defines the SCALE_MIN/SCALE_MAX bounds of 1e-4 and 1e4 that clamp_scale uses; the values should match the official quantizer. |  |
| check | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.init_qparams() | RTN init now clamps s before computing z and rounds z. It shifts the starting grid, but the change is small. |  |
| check | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.fake_quant() | fake_quant is unchanged but now gets the clamped and rounded se/ze from _codes_ste. |  |
| check | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.quantize() | quantize goes through the new _codes_ste; the int32 cast is unchanged. |  |
| check | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.dequant() | dequant clamps s but deliberately leaves z unrounded; callers must round z themselves where training does. |  |
| check | qpeft/quant_schemes/registry.py | _int_uniform() | The lazy import path changed to .torchao. A wrong path would turn the missing-torchao error into a wrong message. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.init_qparams() | The torchao init now goes through the shared clamp/round helpers. The helpers are the critical part. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.fake_quant() | torchao fake_quant switches to the shared helpers. Unlike the reference backend, it keeps torchao's own rounding order. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.quantize() | torchao quantize switches to the shared helpers. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.dequant() | torchao dequant now clamps s, matching the reference backend. |  |
| check | qpeft/trainer.py | _block_linear_names() | Heuristic picks the largest ModuleList of Linear-containing children; a wrong pick quantizes the wrong layers. |  |
| check | qpeft/trainer.py | _prepare_model() | Model preparation and its refusals; a mistake here raises loudly. |  |
| check | qpeft/trainer.py | _GuardCallback.on_train_begin() | Snapshots every trainable param, a memory cost the size of the trainable set. |  |
| check | qpeft/trainer.py | _GuardCallback.on_step_begin() | The lr > 0 check reads the lr before the scheduler steps, so the guard can mis-time. |  |
| check | qpeft/trainer.py | _GuardCallback.on_step_end() | Raises if nothing moved on the first step with lr > 0. A false positive would kill a valid run. |  |
| check | qpeft/trainer.py | _GuardCallback.on_train_end() | Raises at train end if the guard never fired. |  |
| check | qpeft/trainer.py | QATTrainer.__init__() | Resolves the bit-dependent lrs and moves use_cache to the HF config. The loss-kwargs inference affects gradient accumulation scaling. |  |
| check | qpeft/trainer.py | QATTrainer._set_signature_columns_if_needed() | Signature columns come from base.forward; a mistake would drop needed dataset columns. |  |
| check | qpeft/trainer.py | QATTrainer.create_optimizer() | Picks e2e_lr vs quant_lr by phase. A wrong pick trains E2E-QP scales at the Block-AP lr, silently. |  |
| check | qpeft/trainer.py | QATTrainer.compute_loss() | The zero/NaN loss guard raises loudly. |  |
| check | qpeft/trainer.py | QATTrainer._block_ap_batches() | Row counting for short batches was fixed. Too few rows silently shrinks the Block-AP calibration set. |  |
| check | qpeft/trainer.py | QATTrainer.train() | Phase hand-over order: Block-AP, freeze codes, reset optimizer, then E2E-QP. |  |
| check | qpeft/trainer.py | QATTrainer.save_model() | The merge is irreversible and runs on every process; only should_save processes write. |  |
| check | qpeft/training.py | param_groups() | Param grouping by kind; a param in the wrong group gets the wrong lr, but stray params are refused. |  |
| check | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.__init__() | Creates the fp32 adapter on the base device; a wrong device fails loudly. |  |
| check | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.forward() | Sum pooling became mean pooling. It must stay consistent with folded_delta's 1/group_size. |  |
| check | qpeft/tuners/qa_lora/layer.py | dispatch_default() | Passes the device through to the adapter. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.__init__() | fp32 master qparams, compute_dtype, the packing-width refusal and freeze-at-build. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear._init_qparams() | RTN init now runs in the fp32 master dtype, which can differ from the base-dtype quantize in freeze. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.codes() | Unpacks qweight on every access, which costs speed; the unpack itself is correct as long as packing.py is. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.freeze_codes() | Freezes codes in compute_dtype and drops the weight; the dtype must match the later merge. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.apply_config() | Phase switch refuses representation changes and un-freezing, and sets requires_grad per param. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.to_merged_skeleton() | Skeleton qweight shape and dtype must match the saved state_dict; a strict load catches a shape mismatch. |  |
| check | qpeft/tuners/tuners_utils.py | BaseQuantTuner.inject_adapters() | Re-injection now switches the phase instead of skipping; afterwards all non-quant params are frozen. |  |
| check | qpeft/tuners/tuners_utils.py | BaseQuantTuner._freeze_non_quant_params() | Freezes every param outside QuantLinear. Block-AP norms must be re-enabled explicitly. |  |
| check | qpeft/utils.py | check_layer_merge_equivalence() | Compares the layer's forward to a deep-copied merge; uses the scale shape to infer in_features. |  |
| check | qpeft/utils.py | verify_quant_model() | Only checks unmerged layers, so an all-merged model passes vacuously when results is non-empty. |  |
| check | tests/test_block_ap.py | _mse_pairs() | Parses log text; if the log format changes, the parse could break the MSE checks. |  |
| check | tests/test_block_ap.py | test_every_block_reconstructs_better_after_training() | New oracle: every block's MSE must improve after Block-AP. |  |
| check | tests/test_block_ap.py | test_only_block_weights_qparams_and_norms_change() | The suffix allow-list accepts any '.weight' inside the blocks, so an untrained-by-contract weight could change unnoticed. |  |
| check | tests/test_block_ap.py | test_dtypes_and_train_mode_are_restored() | Pins that Block-AP restores dtypes, requires_grad and train mode. |  |
| check | tests/test_block_ap.py | test_refuses_a_model_that_is_not_in_block_ap_phase() | Tests that a model in the wrong phase is refused. |  |
| check | tests/test_block_ap.py | test_refuses_without_calibration_batches() | Tests that an empty calibration loader is refused. |  |
| check | tests/test_block_ap.py | test_cosine_goes_from_lr_down_to_lr_over_min_lr_factor() | Pins the cosine LR schedule: floor clamp, monotonic decay, and no NaN when total is 0. |  |
| check | tests/test_config.py | test_efficient_qat_defaults_match_official_code() | Pins the public default bits=4 and group_size=128 against the official code. |  |
| check | tests/test_config.py | test_config_roundtrips_through_dict_and_disk() | Tests the config round trip through dict and disk. |  |
| check | tests/test_config.py | test_config_from_dict_refuses_an_unknown_field() | Tests that from_dict refuses an unknown field. |  |
| check | tests/test_config.py | test_config_from_dict_refuses_a_different_method() | Tests that a config from a different method is refused. |  |
| check | tests/test_custom_models.py | test_scale_only_training_keeps_codes_frozen() | Existing assertions moved from frozen_codes/qweight to unpacked codes; check the code-freeze check is still just as strict. |  |
| check | tests/test_custom_models.py | test_trainable_weight_has_no_frozen_codes() | Existing assertion replaced: now checks codes_frozen and that weight is present instead of frozen_codes is None. |  |
| check | tests/test_efficient_qat_phases.py | _assert_only_allowed_changed() | Core oracle: allowed params must change and every other one must stay; a bug makes the phase tests vacuous. |  |
| check | tests/test_efficient_qat_phases.py | test_requires_grad_matches_phase() | Pins the requires_grad set per phase and that the weight is dropped in E2E-QP. |  |
| check | tests/test_efficient_qat_phases.py | test_training_changes_only_allowed_params() | Checks that training changes only the params the phase allows. |  |
| check | tests/test_efficient_qat_phases.py | test_e2e_qp_codes_are_frozen_when_scale_moves() | Checks the frozen codes after a scale change, at atol 1e-6. |  |
| check | tests/test_efficient_qat_phases.py | test_schedule_switches_trainable_set_and_keeps_phase1_results() | Checks the phase hand-over: the frozen codes must equal quantize() of the Block-AP result. |  |
| check | tests/test_examples.py | test_example_runs() | Runs the examples as tests. |  |
| check | tests/test_examples.py | test_hf_injection_example_runs() | Runs the HF example; skipped without transformers. |  |
| check | tests/test_examples.py | test_qat_trainer_example_runs() | Adds a slow-gated skip; the trainer example won't run in the default CI. |  |
| check | tests/test_examples.py | test_every_example_is_covered() | Guards that every example has a test. |  |
| check | tests/test_merged_format.py | _trained() | fp16 models skip training, so the fp16 merge test covers only a random B. |  |
| check | tests/test_merged_format.py | _assert_merged_format() | Pins the merged on-disk format: qweight shape, code range, dtypes and state_dict keys. |  |
| check | tests/test_merged_format.py | test_merge_layers_fp32() | Checks merged == trained at 1e-4 for all bits and methods. |  |
| check | tests/test_merged_format.py | test_merge_layers_fp16() | The fp16 merge tolerance is 1e-2 atol/rtol; is that loose enough to hide a fold error? |  |
| check | tests/test_merged_format.py | test_non_target_layers_untouched() | Checks that non-target layers are untouched. |  |
| check | tests/test_merged_format.py | test_merge_is_idempotent() | Checks that merge is idempotent. |  |
| check | tests/test_merged_format.py | test_merge_with_nan_adapter_refuses_and_leaves_layer_untouched() | Checks that a NaN adapter is refused and the layer is left untouched. |  |
| check | tests/test_merged_format.py | test_save_load_every_key_equal() | Checks save/load bit equality for every key and dtype. |  |
| check | tests/test_packing.py | _autogptq_pack() | Copied AutoGPTQ oracle for the packed layout; a copy error would bless a wrong on-disk format. |  |
| check | tests/test_packing.py | test_pack_matches_autogptq() | Checks packing bit-exactly against AutoGPTQ for 2/3/4/8 bits. |  |
| check | tests/test_packing.py | test_unpack_inverts_pack() | Checks the pack/unpack round trip for 1-8 bits. |  |
| check | tests/test_packing.py | test_extreme_codes_survive_the_sign_bit() | Checks that the sign bit survives an all-ones word. |  |
| check | tests/test_packing.py | test_refuses_what_does_not_fill_whole_words() | Checks that bad shapes and out-of-range codes are refused. |  |
| check | tests/test_packing.py | test_layer_refuses_shapes_that_cannot_be_packed() | Checks that a layer refuses a shape that cannot be packed. |  |
| check | tests/test_packing.py | test_merged_codes_take_bits_per_weight() | Checks the packed size and that zero-points stay float. |  |
| check | tests/test_precision.py | test_block_ap_in_bf16_moves_weights_and_keeps_dtypes() | Regression test: bf16 weights must move at the official LR and keep their dtypes. |  |
| check | tests/test_precision.py | test_block_ap_trains_norms_and_reduces_the_mean_reconstruction_error() | The log parse via rsplit is fragile; it asserts that norms train and the MSE drops. |  |
| check | tests/test_precision.py | test_e2e_qp_in_bf16_moves_the_scale() | Regression test: the scale moves in bf16 E2E-QP, and verify_quant_model is run. |  |
| check | tests/test_precision.py | test_qa_lora_adapter_is_fp32_and_moves_in_a_bf16_model() | Checks the adapter is fp32 and moves in a bf16 model. |  |
| check | tests/test_precision.py | test_zero_point_is_an_integer_in_training_and_in_the_artifact() | Pins the integer zero-point and exact merged == fake_quant equality after a drifted z. |  |
| check | tests/test_qa_lora_real_model.py | (outside functions) | Sets the tolerances LOGITS_ATOL=1e-3 and LOSS_RTOL=1e-5 for the lossless-merge claim. |  |
| check | tests/test_qa_lora_real_model.py | _real_model() | Skips on any load exception, which could silently hide a real failure in the slow run. |  |
| check | tests/test_qa_lora_real_model.py | _oracle_codes() | Independent RTN code oracle; the uint8 cast is fine only for bits ≤ 8. |  |
| check | tests/test_qa_lora_real_model.py | test_qa_lora_train_then_merge_is_lossless() | End-to-end lossless-merge test; checks codes bit for bit, an unchanged scale, and that training really happened. |  |
| check | tests/test_qat_trainer.py | _args() | Test args set warmup 0 and accumulation 1; a wrong override makes phase tests pass without any learning. |  |
| check | tests/test_qat_trainer.py | _snap() | The snapshot decides what counts as changed codes; if unfrozen codes are recomputed wrongly, the phase assertions mislead. |  |
| check | tests/test_qat_trainer.py | test_accepts_plain_hf_model_and_targets_block_linears() | Pins default targets to the block linears, so lm_head stays fp. |  |
| check | tests/test_qat_trainer.py | test_default_config_is_paper_default() | Pins the default config at bits 4, group_size 128; a changed default would be caught here. |  |
| check | tests/test_qat_trainer.py | test_refuses_qa_lora_config() | Checks that a QA-LoRA config is refused. |  |
| check | tests/test_qat_trainer.py | test_refuses_qa_lora_quant_model() | Checks that a QA-LoRA QuantModel is refused. |  |
| check | tests/test_qat_trainer.py | test_refuses_targets_that_match_nothing() | Checks that targets matching nothing are refused. |  |
| check | tests/test_qat_trainer.py | test_refuses_merged_model() | Checks that a merged model is refused for training. |  |
| check | tests/test_qat_trainer.py | test_refuses_mid_training_checkpoints() | Only asserts ValueError, without a match on the message. |  |
| check | tests/test_qat_trainer.py | test_runs_both_phases_with_the_right_trainable_sets() | Monkeypatches Trainer.train to inspect the hand-over; checks codes are frozen, the weight dropped and only the scale trains. |  |
| check | tests/test_qat_trainer.py | test_bit_dependent_defaults_resolve() | Pins the 2-bit learning-rate defaults (2e-5 / 2e-5 / 1e-4) against the paper values. |  |
| check | tests/test_qat_trainer.py | test_zero_learning_rate_is_caught() | Loss guard: training with lr 0 must abort. |  |
| check | tests/test_qat_trainer.py | test_train_save_load_is_consistent() | Train, save and load agree within 1e-3 with equal argmax; the tolerance allows device drift. |  |
| check | tests/test_qat_trainer.py | test_accepts_efficient_qat_quant_model_as_is() | An EfficientQAT QuantModel is accepted and used as-is. |  |
| check | tests/test_qat_trainer.py | test_refuses_quant_model_plus_quant_config() | Passing a QuantModel together with a quant_config is refused. |  |
| check | tests/test_qat_trainer.py | test_e2e_qp_optimizer_trains_only_the_scales_at_e2e_lr() | E2E-QP optimizer has a single group of scales at e2e_lr. |  |
| check | tests/test_qat_trainer.py | test_block_ap_hands_over_to_an_e2e_qp_optimizer() | After Block-AP the optimizer is rebuilt with scale-only params at e2e_lr. |  |
| check | tests/test_qat_trainer.py | test_zero_loss_is_caught() | A zero training loss raises. |  |
| check | tests/test_qat_trainer.py | test_block_ap_batches_hold_exactly_block_ap_train_size_rows() | Regression test for the Block-AP sample count on an uneven loader tail. |  |
| check | tests/test_qat_trainer.py | test_gradient_checkpointing_trains_both_phases() | Gradient checkpointing runs through both phases. |  |
| check | tests/test_qat_trainer.py | test_gradient_checkpointing_is_refused_for_a_model_without_it() | A base model without gradient checkpointing is refused. |  |
| check | tests/test_qat_trainer.py | test_use_cache_goes_to_the_hf_model_not_the_qpeft_config() | use_cache is written to the HF config, not the qpeft config. |  |
| check | tests/test_qat_trainer.py | test_push_to_hub_is_refused_with_a_pointer_to_save_model() | push_to_hub and internal saves raise, and the model is left unmerged. |  |
| check | tests/test_qat_trainer.py | test_save_model_merges_everywhere_but_writes_only_on_the_main_process() | Non-main ranks merge but write nothing. |  |
| check | tests/test_qat_trainer.py | test_star_import_works_without_transformers() | Star import works in a subprocess with transformers blocked. |  |
| check | tests/test_qat_trainer.py | test_refuses_push_to_hub_argument() | push_to_hub=True is refused at construction. |  |
| check | tests/test_save_load.py | (outside functions) | Config matrix for the save/load oracle; a missing config would leave a method untested. |  |
| check | tests/test_save_load.py | _merged() | Makes the adapter non-trivial so the fold is exercised; a zero B would hide merge bugs. |  |
| check | tests/test_save_load.py | test_roundtrip_is_bit_exact() | Bit-exact round trip with torch.equal and a fresh seed, so silent re-quantization would fail. |  |
| check | tests/test_save_load.py | test_merge_drops_float_weight() | After merge no float weight remains in the state_dict. |  |
| check | tests/test_save_load.py | test_loaded_model_is_merged_integer_and_frozen() | Loaded model is merged, int32 and frozen. |  |
| check | tests/test_save_load.py | test_saving_unmerged_model_refuses() | Saving an unmerged model is refused. |  |
| check | tests/test_save_load.py | test_unknown_contract_in_saved_config_refuses() | An unknown backend or scheme in the saved config is refused. |  |
| check | tests/test_save_load.py | test_torchao_backend_without_torchao_refuses() | Simulates missing torchao through sys.modules; fragile if the module is cached. |  |
| check | tests/test_save_load.py | test_shape_mismatch_refuses_instead_of_partial_load() | A shape mismatch refuses instead of loading partially. |  |
| check | tests/test_save_load.py | test_fp16_dtypes_survive_roundtrip() | fp16 dtypes survive the round trip. |  |
| check | tests/test_ste_gradients.py | test_clamp_scale_passes_gradient_one() | Pins the clamp_scale STE gradient at 1, both inside and outside the bounds. |  |
| check | tests/test_ste_gradients.py | test_round_zero_point_passes_gradient_one() | Pins the round_zero_point STE gradient at 1. |  |
| check | tests/test_ste_gradients.py | test_fp16_codes_round_before_adding_the_zero_point() | Pins the fp16 rounding order round(w/s)+z against the official formula. |  |
| check | tests/test_tinygemm.py | _merged() | Randomizes adapter B so the fold is non-trivial before merge. |  |
| check | tests/test_tinygemm.py | test_tinygemm_zero_gives_the_same_weight() | Checks z_f=(8-z)*s exactly in float64, including fractional zeros. |  |
| check | tests/test_tinygemm.py | test_int4_pairs_hold_even_columns_in_the_high_nibble() | Pins even columns to the high nibble in int4 packing; the wrong order would scramble weights. |  |
| check | tests/test_tinygemm.py | test_refuses_an_unmerged_layer() | An unmerged layer is refused. |  |
| check | tests/test_tinygemm.py | test_refuses_what_the_kernel_cannot_run() | 3-bit and group size 16 are refused. |  |
| check | tests/test_tinygemm.py | test_refuses_out_features_off_the_kernel_tiles() | out_features that is not a multiple of 8 is refused. |  |
| check | tests/test_tinygemm.py | test_to_tinygemm_changes_nothing_when_one_layer_is_refused() | All layers are checked before any is replaced. |  |
| check | tests/test_tinygemm.py | test_refuses_without_cuda() | Refusal on machines without CUDA; skipped on CUDA machines. |  |
| check | tests/test_tinygemm.py | test_kernel_matches_the_merged_layer() | Kernel against merged layer within 1e-2 relative error; only runs on CUDA. |  |
| check | tests/test_tinygemm.py | test_wrong_zero_point_is_caught() | Negative control that proves the 1e-2 tolerance can catch a wrong zero-point. |  |
| check | tests/test_tinygemm_real_model.py | setup() | Skips on any exception, so a real load bug would read as offline; asserts the adapters are non-zero. |  |
| check | tests/test_tinygemm_real_model.py | _ppl() | Averages per-batch losses; equal batch sizes keep this correct. |  |
| check | tests/test_tinygemm_real_model.py | test_every_target_runs_on_the_kernel() | Every target layer is replaced by the kernel. |  |
| check | tests/test_tinygemm_real_model.py | test_logits_match_the_merged_model() | Logits and argmax gates; the thresholds come from U68. |  |
| check | tests/test_tinygemm_real_model.py | test_perplexity_matches_the_merged_model() | Perplexity within PPL_RTOL. |  |
| check | tests/test_tinygemm_real_model.py | _next_token_margin() | Top-1 minus top-2 margin at the last position. |  |
| check | tests/test_tinygemm_real_model.py | test_saved_and_loaded_model_runs_the_same_kernel() | Save, load, then to_tinygemm must be bit-identical to the in-memory export. |  |
| check | tests/test_training.py | test_block_ap_groups_weights_and_qparams_with_their_own_lr() | Block-AP groups: weights at weight_lr, qparams at quant_lr. |  |
| check | tests/test_training.py | test_e2e_qp_groups_only_the_scale() | E2E-QP has a single group of scales. |  |
| check | tests/test_training.py | test_qa_lora_groups_only_the_adapter() | QA-LoRA has only the adapter group at adapter_lr. |  |
| check | tests/test_training.py | test_every_trainable_parameter_is_in_exactly_one_group() | Each trainable parameter sits in exactly one group; a missing one would silently not train. |  |
| check | tests/test_training.py | test_extra_weights_join_the_weight_group() | Norm weights join the weight group. |  |
| check | tests/test_training.py | test_trainable_parameter_outside_quant_linear_refuses() | A stray trainable parameter outside QuantLinear is refused. |  |
| check | tests/test_training.py | test_nothing_trainable_refuses() | Nothing trainable is refused. |  |
| check | tests/test_training.py | test_weight_decay_reaches_every_group() | Weight decay reaches every group. |  |
| skim | .gitignore | lines 15-15 | Ignores a local TASKS.md file. |  |
| skim | CLAUDE.md | (outside functions) | CLAUDE.md trimmed; status and plans moved out. |  |
| skim | README.md | (outside functions) | Docs, but lines 97 and 109 still say codes are unpacked and there is no export layer; both are now stale. |  |
| skim | docs/DESIGN.md | (outside functions) | Path updated after the module move. |  |
| skim | docs/specs/qat_trainer.md | (outside functions) | Spec prose; its defaults table should match QATTrainingArguments in trainer.py. |  |
| skim | docs/specs/save_load.md | (outside functions) | Save/load spec prose; the implementation units carry the risk. |  |
| skim | examples/README.md | (outside functions) | Examples README text. |  |
| skim | examples/qat_trainer.py | (outside functions) | Example script; test_examples runs it. |  |
| skim | examples/quickstart.py | (outside functions) | Docstring only. |  |
| skim | examples/train_efficient_qat.py | (outside functions) | Docstring and import changes. |  |
| skim | examples/train_efficient_qat.py | check_equivalence() | Swaps to verify_quant_model; only printing logic is left. |  |
| skim | examples/train_qa_lora.py | (outside functions) | Import swap. |  |
| skim | examples/train_qa_lora.py | main() | Swaps to verify_quant_model. |  |
| skim | qpeft/block_ap.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/block_ap.py | class _StopForward | Sentinel exception class. |  |
| skim | qpeft/block_ap.py | _first() | Takes the first output of a tuple. |  |
| skim | qpeft/block_ap.py | _detach() | Recursive detach helper. |  |
| skim | qpeft/config.py | (outside functions) | Imports and the config file name constant. |  |
| skim | qpeft/config.py | class QuantTuningType | Comment removed. |  |
| skim | qpeft/config.py | class TrainableParams | Comment removed. |  |
| skim | qpeft/config.py | class QuantTuningConfig | Comments removed; fields unchanged. |  |
| skim | qpeft/config.py | QuantTuningConfig.save_pretrained() | Writes JSON to disk. |  |
| skim | qpeft/config.py | QuantTuningConfig.from_pretrained() | Reads JSON and delegates to from_dict. |  |
| skim | qpeft/kernels/__init__.py | lines 1-4 | Package re-exports. |  |
| skim | qpeft/kernels/tinygemm.py | (outside functions) | Docstring and constants. |  |
| skim | qpeft/kernels/tinygemm.py | class TinyGemmLinear | Class shell. |  |
| skim | qpeft/mapping.py | (outside functions) | Registry rename and comments. |  |
| skim | qpeft/packing.py | (outside functions) | Docstring and mask constant. |  |
| skim | qpeft/peft_model.py | (outside functions) | Imports and the weights file name. |  |
| skim | qpeft/peft_model.py | class QuantModel | Class layout and section comments. |  |
| skim | qpeft/peft_model.py | QuantModel.quant_layers() | Lists the QuantLinear modules. |  |
| skim | qpeft/quant_schemes/__init__.py | (outside functions) | Package re-exports. |  |
| skim | qpeft/quant_schemes/base.py | class _IntUniformScheme | Blank lines only. |  |
| skim | qpeft/quant_schemes/base.py | class ReferenceIntUniformScheme | Old class removed from base.py; it moved to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme._expand() | Removed code, moved unchanged to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.init_qparams() | Removed code; the new version is in reference.py (U20). |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme._codes_ste() | Removed code; the new version is in reference.py (U21). |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.fake_quant() | Removed code, moved unchanged to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.quantize() | Removed code, moved unchanged to reference.py. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.dequant() | Removed code; the new version is in reference.py (U24). |  |
| skim | qpeft/quant_schemes/base.py | register_scheme() | Removed code, moved unchanged to registry.py. |  |
| skim | qpeft/quant_schemes/base.py | build_scheme() | Removed code, moved unchanged to registry.py. |  |
| skim | qpeft/quant_schemes/base.py | _int_uniform() | Removed code; moved to registry.py with a new import path. |  |
| skim | qpeft/quant_schemes/reference.py | (outside functions) | Imports and module docstring. |  |
| skim | qpeft/quant_schemes/reference.py | class ReferenceIntUniformScheme | Docstring for the changed code formula. |  |
| skim | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme._expand() | _expand moved unchanged. |  |
| skim | qpeft/quant_schemes/registry.py | (outside functions) | Imports and comments for the moved registry. |  |
| skim | qpeft/quant_schemes/registry.py | register_scheme() | register_scheme moved unchanged. |  |
| skim | qpeft/quant_schemes/registry.py | build_scheme() | build_scheme moved unchanged. |  |
| skim | qpeft/quant_schemes/torchao.py | (outside functions) | Import paths updated after the package move. |  |
| skim | qpeft/trainer.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/trainer.py | class _GuardCallback | Class docstring and message constant. |  |
| skim | qpeft/trainer.py | _GuardCallback.__init__() | Trivial state init. |  |
| skim | qpeft/trainer.py | class QATTrainer | Class shell, section comments and the message constant. |  |
| skim | qpeft/trainer.py | QATTrainer._log_setup() | Print statements. |  |
| skim | qpeft/trainer.py | QATTrainer.push_to_hub() | Refusal override with a pointer to save_model. |  |
| skim | qpeft/training.py | (outside functions) | Imports and docstring. |  |
| skim | qpeft/tuners/efficient_qat/layer.py | (outside functions) | Import path update. |  |
| skim | qpeft/tuners/qa_lora/layer.py | (outside functions) | Import path update. |  |
| skim | qpeft/tuners/qa_lora/layer.py | class ZeroPointFoldLoRA | Docstring. |  |
| skim | qpeft/tuners/tuners_utils.py | (outside functions) | Imports. |  |
| skim | qpeft/tuners/tuners_utils.py | class QuantLinear | Docstring and section comments. |  |
| skim | qpeft/tuners/tuners_utils.py | class BaseQuantTuner | Blank line. |  |
| skim | qpeft/utils.py | (outside functions) | Import path moved from schemes to quant_schemes; a mistake would fail loudly at import. |  |
| skim | tests/test_block_ap.py | (outside functions) | Imports and a list of target-module names. |  |
| skim | tests/test_block_ap.py | _llama() | Builds a tiny random Llama for the test. |  |
| skim | tests/test_block_ap.py | _batches() | Builds seeded random calibration batches. |  |
| skim | tests/test_block_ap.py | _qmodel() | Test model factory. |  |
| skim | tests/test_block_ap.py | _run() | Wraps run_block_ap and collects its log lines. |  |
| skim | tests/test_config.py | (outside functions) | Import changes plus a section comment. |  |
| skim | tests/test_efficient_qat_phases.py | (outside functions) | Docstring, imports and the table of trainable params per phase. |  |
| skim | tests/test_efficient_qat_phases.py | _task() | Synthetic regression task helper. |  |
| skim | tests/test_efficient_qat_phases.py | _base() | Base model factory. |  |
| skim | tests/test_efficient_qat_phases.py | _layers() | Collects the QuantLinear layers and refuses an empty list. |  |
| skim | tests/test_efficient_qat_phases.py | _snapshot() | Snapshots layer tensors. |  |
| skim | tests/test_efficient_qat_phases.py | _train() | Adam training loop helper. |  |
| skim | tests/test_efficient_qat_phases.py | _trainable() | Lists which parameters require grad. |  |
| skim | tests/test_examples.py | (outside functions) | Docstring and path setup. |  |
| skim | tests/test_examples.py | _run() | Runs an example script with runpy. |  |
| skim | tests/test_initialization.py | (outside functions) | Import path update. |  |
| skim | tests/test_merge_equivalence.py | (outside functions) | Import path update. |  |
| skim | tests/test_merged_format.py | (outside functions) | Docstring describing the format contract, plus method configs. |  |
| skim | tests/test_merged_format.py | _base() | Base model factory. |  |
| skim | tests/test_packing.py | (outside functions) | Imports. |  |
| skim | tests/test_packing.py | _codes() | Random code generator. |  |
| skim | tests/test_precision.py | (outside functions) | Docstring and imports. |  |
| skim | tests/test_precision.py | _llama_bf16() | Tiny bf16 Llama factory. |  |
| skim | tests/test_precision.py | _batches() | Batch helper. |  |
| skim | tests/test_precision.py | _norms() | Selects the norm params. |  |
| skim | tests/test_qa_lora_real_model.py | _tiny_llama() | Tiny model factory. |  |
| skim | tests/test_qa_lora_real_model.py | _loss() | Loss helper. |  |
| skim | tests/test_qa_lora_real_model.py | _train_adapters() | Adam training loop helper. |  |
| skim | tests/test_qat_trainer.py | (outside functions) | Imports, an importorskip on transformers and section comments only. |  |
| skim | tests/test_qat_trainer.py | class _Data | Empty class shell for the test dataset. |  |
| skim | tests/test_qat_trainer.py | _Data.__init__() | Seeded random token ids for the dataset; trivial. |  |
| skim | tests/test_qat_trainer.py | _Data.__len__() | Dataset length; trivial. |  |
| skim | tests/test_qat_trainer.py | _Data.__getitem__() | Returns labels equal to input_ids; trivial. |  |
| skim | tests/test_qat_trainer.py | _collate() | Stacking collate function; trivial. |  |
| skim | tests/test_qat_trainer.py | _llama() | Builds a tiny Llama config for the tests. |  |
| skim | tests/test_qat_trainer.py | _trainer() | Builds the trainer; only passes arguments through. |  |
| skim | tests/test_qat_trainer.py | _cfg() | Config factory for w4g64. |  |
| skim | tests/test_qat_trainer.py | _changed_kinds() | Set of changed parameter kinds; simple. |  |
| skim | tests/test_save_load.py | _base() | Small base model factory. |  |
| skim | tests/test_save_load.py | _quant_layers() | Layer finder that asserts it found at least one layer. |  |
| skim | tests/test_ste_gradients.py | (outside functions) | Imports and docstring. |  |
| skim | tests/test_ste_gradients.py | _scheme() | Scheme factory. |  |
| skim | tests/test_tinygemm.py | (outside functions) | Imports and the CUDA skip marker. |  |
| skim | tests/test_tinygemm.py | _qalora() | Config factory. |  |
| skim | tests/test_tinygemm.py | _rel_err() | Relative-error helper. |  |
| skim | tests/test_tinygemm_real_model.py | _windows() | WikiText window loader. |  |
| skim | tests/test_tinygemm_real_model.py | _base() | Loads the base model. |  |
| skim | tests/test_tinygemm_real_model.py | _logits() | Logits helper. |  |
| skim | tests/test_tinygemm_real_model.py | _greedy() | Greedy generation helper. |  |
| skim | tests/test_torchao_backend.py | (outside functions) | Import path follows the move to quant_schemes. |  |
| skim | tests/test_training.py | (outside functions) | Imports and the learning-rate constants. |  |
| skim | tests/test_training.py | _base() | Base model factory. |  |
| skim | tests/test_training.py | _layers() | Layer finder. |  |
| skim | tests/test_training.py | _ids() | Set of parameter ids. |  |
| skim | tests/test_training.py | _by_name() | Groups indexed by name. |  |

## Claude's draft .review-guide.md

```markdown
# Review guide: qpeft

## Critical
- Quantizer math in `qpeft/quant_schemes/` (fake_quant, STE, clamp_scale, round_zero_point, merge fold `z' = z - delta / s`): train and merge must stay numerically equal.
- The on-disk format: `qpeft/packing.py` (GPTQ qweight layout), `QuantModel.save_pretrained` / `from_pretrained`, `QuantTuningConfig.from_dict`, `QuantLinear.to_merged_skeleton`.
- Kernel exports (`qpeft/kernels/`): zero-point conversion, nibble order, scale/zero layout, dtype rounding.
- Block-AP and the phase switch (`block_ap.py`, `QuantLinear.freeze_codes` / `apply_config`): which params train, dtype casts, fp targets vs quantized inputs.
- Defaults that mirror official EfficientQAT (`QATTrainingArguments`, `EfficientQATConfig`, LR schedule formulas).
- Tests: any loosened tolerance, removed assertion or new skip in `tests/` (especially merge equivalence, save/load bit-exactness, packing vs AutoGPTQ, STE gradients).

## Source of truth
- `docs/specs/*.md` for behavior and refusal tables; `tests/test_save_load.py` must not be weakened.
- OpenGVLab/EfficientQAT for quantizer and training defaults; AutoGPTQ for the packing layout.
- `check_merge_equivalence` / `verify_quant_model` is the gate every scheme must pass.

## Skim
- README.md, CLAUDE.md, docs/DESIGN.md, examples/README.md prose (but flag statements that contradict code, e.g. "not bit-packed yet").
- Re-exports in `__init__.py` files, comment removals, renames in `mapping.py`.
- Log messages and example print statements.
```
