# Q1-Q3 measurement: gapsong/qpeft PR #8 (main...develop at 4369298)

Head 43692980963628ae56dc0c94955a0bde5261e56e, merge base 8bac6aa50669196e5792674385b1a6f73ad25092. Model claude-opus-5-5. No .review-guide.md on main, so Claude used the general rules.

## Result

| Check | Target | Strict reading | Generous reading |
|---|---|---|---|
| Q1 gold units tiered critical | all | 15/15 | 17/22 |
| Q2 critical units outside the gold list | at most 10 | 25 (0 weakened-test rule, 25 by Claude) | 23 (0 rule, 23 Claude) |
| Q3 time from opening the PR to the overview | at most 120 s | 75 s | |

Units: 314 (critical 40, check 157, skim 117). Python units that fell back to raw hunks: 1.
Pass 1: 51 s in Claude, 64299 tokens in, 5843 tokens out.
Pass 2: Pass 2 waits for you: 40 critical units (more than 25)..

## Gold list, unit by unit

| Area | File | Gold function | Unit | Tier | Claude's reason |
|---|---|---|---|---|---|
| Quantization formula and STE | qpeft/quant_schemes/reference.py | _codes_ste | ReferenceIntUniformScheme._codes_ste() | critical | Codes are now round(w/s)+z instead of round(w/s+z), with a new STE. Rounding order and gradients change quietly. |
| Quantization formula and STE | qpeft/quant_schemes/reference.py | fake_quant (generous) | ReferenceIntUniformScheme.fake_quant() | check | Same formula as before, but it now works on the clamped and rounded ze from _codes_ste. |
| Quantization formula and STE | qpeft/quant_schemes/reference.py | quantize (generous) | ReferenceIntUniformScheme.quantize() | check | The artifact codes come from the new _codes_ste. Do .round() and the int32 cast still give integers inside the range? |
| Quantization formula and STE | qpeft/quant_schemes/base.py | _ste | _ste() | critical | STE now detaches value: a wrong detach doubles or drops the scale gradient with no error. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | clamp_scale | _IntUniformScheme.clamp_scale() | critical | clamp_scale sits in every primitive and in the merge: confirm the gradient is 1 and the forward is exactly the clamped scale. |
| Quantization formula and STE | qpeft/quant_schemes/base.py | round_zero_point | _IntUniformScheme.round_zero_point() | critical | Zero-point is now rounded and clamped to [qmin, qmax]: this changes the numbers in training and in the artifact. |
| Packing and merge fold | qpeft/packing.py | pack_codes | pack_codes() | critical | GPTQ pack: carry into the next word via >>32 and the int32 sign wrap must match AutoGPTQ exactly, 3-bit included. |
| Packing and merge fold | qpeft/packing.py | unpack_codes | unpack_codes() | critical | Unpack must invert the pack for word-crossing 3-bit codes; the shift by 32 - 0 on aligned codes needs checking. |
| Packing and merge fold | qpeft/packing.py | _offsets (generous) | _offsets() | critical | Bit offsets and the multiple-of-32 refusal define the packed on-disk layout. |
| Packing and merge fold | qpeft/quant_schemes/base.py | merge | _IntUniformScheme.merge() | critical | Merge now clamps s and rounds z before the fold z - delta/s. Does it still match what training computed exactly? |
| Packing and merge fold | qpeft/tuners/tuners_utils.py | QuantLinear.merge | QuantLinear.merge() | critical | Merge casts to compute_dtype, packs codes, runs the NaN check before mutating, and drops the weight. This is the artifact format. |
| tinygemm and code freezing | qpeft/kernels/tinygemm.py | tinygemm_zero | tinygemm_zero() | critical | Zero conversion z_f = (8 - z) * s must reproduce (q - z) * s exactly for fractional z. |
| tinygemm and code freezing | qpeft/kernels/tinygemm.py | TinyGemmLinear.__init__ | TinyGemmLinear.__init__() | critical | scales_and_zeros stack/transpose layout and the bf16 rounding of s and z_f decide every exported weight. |
| tinygemm and code freezing | qpeft/tuners/tuners_utils.py | QuantLinear.freeze_codes | QuantLinear.freeze_codes() | critical | Codes are fixed from the compute_dtype cast of the fp32 masters, and the weight is dropped. Codes chosen wrongly here cannot be recovered later. |
| Block-AP and trainer defaults | qpeft/block_ap.py | run_block_ap | run_block_ap() | critical | Block-AP core: fp targets with quant disabled, fp32 cast and back, quantized-vs-fp input chains; a swap goes unnoticed. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _to_float32 (generous) | _to_float32() | check | Casts every floating kwarg to fp32, including attention masks and rotary tuples; dict or cache kwargs are not handled. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _cast_params (generous) | _cast_params() | check | Swaps p.data dtype in place; any lingering optimizer state or alias would go stale. |
| Block-AP and trainer defaults | qpeft/block_ap.py | _norm_weights (generous) | _norm_weights() | check | Name filter decides which norm params Block-AP trains; a wrong match trains or skips the wrong parameters. |
| Block-AP and trainer defaults | qpeft/trainer.py | QATTrainer.__init__ | QATTrainer.__init__() | critical | Bit-dependent lr defaults, the use_cache redirect and accepts_loss_kwargs affect loss scaling and training without errors. |
| Block-AP and trainer defaults | qpeft/trainer.py | QATTrainingArguments (generous) | class QATTrainingArguments | critical | Public training defaults (lrs, batch, warmup_steps=0.03 as ratio, grad norm, save_strategy) silently shape every run. |
| Block-AP and trainer defaults | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.forward | ZeroPointFoldLoRA.forward() | critical | Sum pooling became mean pooling, which rescales the adapter; forward must match folded_delta's 1/group_size. |
| Block-AP and trainer defaults | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.folded_delta | ZeroPointFoldLoRA.folded_delta() | critical | Fold now divides by group_size. If it does not match the mean-pooled forward, the merged model is quietly wrong. |

## Critical units outside the gold list (strict reading)

| File | Unit | Reason |
|---|---|---|
| qpeft/block_ap.py | _cosine() | Cosine formula: does it end at exactly lr/min_lr_factor, and what if total is 0? |
| qpeft/config.py | QuantTuningConfig.from_dict() | Load path drops the saved trainable_params without a word and picks the class from the saved type; a mismatch could rebuild the wrong config. |
| qpeft/kernels/tinygemm.py | pack_int4_pairs() | Nibble order (even column in the high nibble); if it is wrong, every weight is permuted with no error. |
| qpeft/kernels/tinygemm.py | TinyGemmLinear.forward() | Forward casts the input to bf16 and back and adds the bias afterwards; a precision loss here would be quiet. |
| qpeft/packing.py | _offsets() | Bit offsets and the multiple-of-32 refusal define the packed on-disk layout. |
| qpeft/peft_model.py | QuantModel.save_pretrained() | Persistence: saves the full state_dict; must hold only int codes and no fp weight after the merge. |
| qpeft/peft_model.py | QuantModel.from_pretrained() | Load: skeleton, strict load and frozen params; the dtype and device of the loaded tensors versus the base model need checking. |
| qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.init_qparams() | RTN init: clamp_min(1e-8) was replaced by clamp_scale, and z is rounded using the already-clamped s. Is init still consistent? |
| qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.dequant() | Dequant clamps s but deliberately leaves z unrounded. Callers on the frozen path must round z themselves, or the weights drift. |
| qpeft/trainer.py | class QATTrainingArguments | Public training defaults (lrs, batch, warmup_steps=0.03 as ratio, grad norm, save_strategy) silently shape every run. |
| qpeft/trainer.py | QATTrainer.create_optimizer() | Chooses e2e_lr or quant_lr by phase. A wrong lr for the scale group would not raise an error. |
| qpeft/trainer.py | QATTrainer.save_model() | Irreversible merge runs on every rank and writes only where should_save. This decides the artifact on disk. |
| qpeft/training.py | param_groups() | Assigns parameters to lr groups: a parameter in the wrong group or missed trains at the wrong lr without error. |
| qpeft/tuners/efficient_qat/config.py | class EfficientQATConfig | Public default changed to bits=4, group_size=128, which changes every model built without explicit arguments. |
| qpeft/tuners/tuners_utils.py | QuantLinear.__init__() | fp32 master qparams, compute_dtype, a new packing refusal and a freeze at init. Precision decisions here affect every layer. |
| qpeft/tuners/tuners_utils.py | QuantLinear.forward() | Forward casts parameters to the input dtype and rounds z on the frozen path. It must match the merge numerically. |
| qpeft/tuners/tuners_utils.py | QuantLinear.to_merged_skeleton() | Load skeleton shape (in*bits//32, out) and scale/zero-point dtypes must match the saved layout, or loading fails or corrupts. |
| qpeft/utils.py | _merge_tolerance() | New tolerance: half precision allows 1e-2 times max\|output\|, which could hide a real fold error on large activations. |
| qpeft/utils.py | check_layer_merge_equivalence() | Returns 0.0 early for merged layers and derives in_f from scale shape, so a bad layer could pass silently. |
| tests/test_custom_models.py | test_fp16_base_survives_injection_and_forward() | Changed assertion: scale and zero_point dtype expectation flips from fp16 to fp32 masters; confirm the merge casts back. |
| tests/test_examples.py | test_qat_trainer_example_runs() | Adds a skip: the QATTrainer example runs only with QPEFT_RUN_SLOW=1, so CI never exercises it. |
| tests/test_packing.py | _autogptq_pack() | This transcribed AutoGPTQ pack loop is the packing oracle; a transcription slip (3-bit spill) would validate a wrong on-disk layout. |
| tests/test_qa_lora_real_model.py | (outside functions) | Defines LOGITS_ATOL 1e-3 and LOSS_RTOL 1e-5, and the real-model case is skipped unless QPEFT_RUN_SLOW is set. |
| tests/test_tinygemm_real_model.py | (outside functions) | Scoreboard thresholds: 3e-2 logits error, 0.99 argmax agreement, 0.5% ppl, and a 0.5 tie margin that lets greedy generation diverge. |
| tests/test_tinygemm_real_model.py | test_greedy_generation_matches_the_merged_model() | Escape hatch: greedy divergence passes if the merged model's margin is under 0.5; this could hide a kernel error. |

## What this PR does (Claude's summary)

This PR merges the develop branch into main. It adds the QATTrainer for EfficientQAT, which runs Block-AP, then freezes the codes, then runs E2E-QP. It also adds save/load of a merged model as an integer artifact, and it moves the scheme code into a new `quant_schemes/` package. Frozen and merged codes are now packed in the GPTQ qweight layout, and the fp weight is dropped once the codes are frozen. The quantizer is changed to match the official EfficientQAT code: the scale gradient was counted twice, and the rounding order is now round(w/s)+z. A tinygemm int4 CUDA export is added that maps the float zero-point through z_f = (8 - z) * s.

## All units

| Tier | File | Unit | Reason | Worth having? |
|---|---|---|---|---|
| critical | qpeft/block_ap.py | _cosine() | Cosine formula: does it end at exactly lr/min_lr_factor, and what if total is 0? |  |
| critical | qpeft/block_ap.py | run_block_ap() | Block-AP core: fp targets with quant disabled, fp32 cast and back, quantized-vs-fp input chains; a swap goes unnoticed. |  |
| critical | qpeft/config.py | QuantTuningConfig.from_dict() | Load path drops the saved trainable_params without a word and picks the class from the saved type; a mismatch could rebuild the wrong config. |  |
| critical | qpeft/kernels/tinygemm.py | tinygemm_zero() | Zero conversion z_f = (8 - z) * s must reproduce (q - z) * s exactly for fractional z. |  |
| critical | qpeft/kernels/tinygemm.py | pack_int4_pairs() | Nibble order (even column in the high nibble); if it is wrong, every weight is permuted with no error. |  |
| critical | qpeft/kernels/tinygemm.py | TinyGemmLinear.__init__() | scales_and_zeros stack/transpose layout and the bf16 rounding of s and z_f decide every exported weight. |  |
| critical | qpeft/kernels/tinygemm.py | TinyGemmLinear.forward() | Forward casts the input to bf16 and back and adds the bias afterwards; a precision loss here would be quiet. |  |
| critical | qpeft/packing.py | _offsets() | Bit offsets and the multiple-of-32 refusal define the packed on-disk layout. |  |
| critical | qpeft/packing.py | pack_codes() | GPTQ pack: carry into the next word via >>32 and the int32 sign wrap must match AutoGPTQ exactly, 3-bit included. |  |
| critical | qpeft/packing.py | unpack_codes() | Unpack must invert the pack for word-crossing 3-bit codes; the shift by 32 - 0 on aligned codes needs checking. |  |
| critical | qpeft/peft_model.py | QuantModel.save_pretrained() | Persistence: saves the full state_dict; must hold only int codes and no fp weight after the merge. |  |
| critical | qpeft/peft_model.py | QuantModel.from_pretrained() | Load: skeleton, strict load and frozen params; the dtype and device of the loaded tensors versus the base model need checking. |  |
| critical | qpeft/quant_schemes/base.py | _ste() | STE now detaches value: a wrong detach doubles or drops the scale gradient with no error. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.clamp_scale() | clamp_scale sits in every primitive and in the merge: confirm the gradient is 1 and the forward is exactly the clamped scale. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.round_zero_point() | Zero-point is now rounded and clamped to [qmin, qmax]: this changes the numbers in training and in the artifact. |  |
| critical | qpeft/quant_schemes/base.py | _IntUniformScheme.merge() | Merge now clamps s and rounds z before the fold z - delta/s. Does it still match what training computed exactly? |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.init_qparams() | RTN init: clamp_min(1e-8) was replaced by clamp_scale, and z is rounded using the already-clamped s. Is init still consistent? |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme._codes_ste() | Codes are now round(w/s)+z instead of round(w/s+z), with a new STE. Rounding order and gradients change quietly. |  |
| critical | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.dequant() | Dequant clamps s but deliberately leaves z unrounded. Callers on the frozen path must round z themselves, or the weights drift. |  |
| critical | qpeft/trainer.py | class QATTrainingArguments | Public training defaults (lrs, batch, warmup_steps=0.03 as ratio, grad norm, save_strategy) silently shape every run. |  |
| critical | qpeft/trainer.py | QATTrainer.__init__() | Bit-dependent lr defaults, the use_cache redirect and accepts_loss_kwargs affect loss scaling and training without errors. |  |
| critical | qpeft/trainer.py | QATTrainer.create_optimizer() | Chooses e2e_lr or quant_lr by phase. A wrong lr for the scale group would not raise an error. |  |
| critical | qpeft/trainer.py | QATTrainer.save_model() | Irreversible merge runs on every rank and writes only where should_save. This decides the artifact on disk. |  |
| critical | qpeft/training.py | param_groups() | Assigns parameters to lr groups: a parameter in the wrong group or missed trains at the wrong lr without error. |  |
| critical | qpeft/tuners/efficient_qat/config.py | class EfficientQATConfig | Public default changed to bits=4, group_size=128, which changes every model built without explicit arguments. |  |
| critical | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.forward() | Sum pooling became mean pooling, which rescales the adapter; forward must match folded_delta's 1/group_size. |  |
| critical | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.folded_delta() | Fold now divides by group_size. If it does not match the mean-pooled forward, the merged model is quietly wrong. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.__init__() | fp32 master qparams, compute_dtype, a new packing refusal and a freeze at init. Precision decisions here affect every layer. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.forward() | Forward casts parameters to the input dtype and rounds z on the frozen path. It must match the merge numerically. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.freeze_codes() | Codes are fixed from the compute_dtype cast of the fp32 masters, and the weight is dropped. Codes chosen wrongly here cannot be recovered later. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.merge() | Merge casts to compute_dtype, packs codes, runs the NaN check before mutating, and drops the weight. This is the artifact format. |  |
| critical | qpeft/tuners/tuners_utils.py | QuantLinear.to_merged_skeleton() | Load skeleton shape (in*bits//32, out) and scale/zero-point dtypes must match the saved layout, or loading fails or corrupts. |  |
| critical | qpeft/utils.py | _merge_tolerance() | New tolerance: half precision allows 1e-2 times max\|output\|, which could hide a real fold error on large activations. |  |
| critical | qpeft/utils.py | check_layer_merge_equivalence() | Returns 0.0 early for merged layers and derives in_f from scale shape, so a bad layer could pass silently. |  |
| critical | tests/test_custom_models.py | test_fp16_base_survives_injection_and_forward() | Changed assertion: scale and zero_point dtype expectation flips from fp16 to fp32 masters; confirm the merge casts back. |  |
| critical | tests/test_examples.py | test_qat_trainer_example_runs() | Adds a skip: the QATTrainer example runs only with QPEFT_RUN_SLOW=1, so CI never exercises it. |  |
| critical | tests/test_packing.py | _autogptq_pack() | This transcribed AutoGPTQ pack loop is the packing oracle; a transcription slip (3-bit spill) would validate a wrong on-disk layout. |  |
| critical | tests/test_qa_lora_real_model.py | (outside functions) | Defines LOGITS_ATOL 1e-3 and LOSS_RTOL 1e-5, and the real-model case is skipped unless QPEFT_RUN_SLOW is set. |  |
| critical | tests/test_tinygemm_real_model.py | (outside functions) | Scoreboard thresholds: 3e-2 logits error, 0.99 argmax agreement, 0.5% ppl, and a 0.5 tie margin that lets greedy generation diverge. |  |
| critical | tests/test_tinygemm_real_model.py | test_greedy_generation_matches_the_merged_model() | Escape hatch: greedy divergence passes if the merged model's margin is under 0.5; this could hide a kernel error. |  |
| check | examples/train_efficient_qat.py | main() | The example asserts frozen codes, weight None and a scale-only trainable set, and test_examples runs it. |  |
| check | pyproject.toml | lines 10-11 | New transformers <6 / accelerate dependencies; the pin relies on Trainer internals. |  |
| check | qpeft/__init__.py | (outside functions) | Public exports change, and the old qpeft.schemes import path is gone. |  |
| check | qpeft/__init__.py | __getattr__() | Lazy __getattr__: an ImportError from inside trainer.py could be hidden behind the 'install transformers' message. |  |
| check | qpeft/block_ap.py | find_blocks() | Picking the longest ModuleList could pick the wrong list of blocks on unusual architectures. |  |
| check | qpeft/block_ap.py | _to_float32() | Casts every floating kwarg to fp32, including attention masks and rotary tuples; dict or cache kwargs are not handled. |  |
| check | qpeft/block_ap.py | _norm_weights() | Name filter decides which norm params Block-AP trains; a wrong match trains or skips the wrong parameters. |  |
| check | qpeft/block_ap.py | _cast_params() | Swaps p.data dtype in place; any lingering optimizer state or alias would go stale. |  |
| check | qpeft/block_ap.py | _capture_block_inputs() | The hook captures first-block args and kwargs; a missing position or mask kwarg would feed wrong inputs quietly. |  |
| check | qpeft/block_ap.py | _mean_mse() | MSE only for the log; it does not affect training. |  |
| check | qpeft/config.py | QuantTuningConfig.to_dict() | Serialization of enums and tuples to JSON; a missed type would break the load. |  |
| check | qpeft/config.py | QuantTuningConfig.save_pretrained() | Writes the config JSON; simple persistence. |  |
| check | qpeft/config.py | QuantTuningConfig.from_pretrained() | Reads the config JSON; delegates to from_dict. |  |
| check | qpeft/kernels/tinygemm.py | _inner_k_tiles() | Chooses inner_k_tiles by divisibility; a wrong choice would fail loudly in the kernel. |  |
| check | qpeft/kernels/tinygemm.py | check_supported() | Refusal gate: is group_size dividing in_features checked, and does the torch version parse hold for dev builds? |  |
| check | qpeft/kernels/tinygemm.py | to_tinygemm() | Checks all layers first, then replaces them in place; the parent lookup by name could be wrong. |  |
| check | qpeft/mapping.py | (outside functions) | Renames the public mapping constant _MODEL_ to _TUNER_; external imports break. |  |
| check | qpeft/mapping.py | get_quant_model() | Lazy import to break the cycle; the return annotation is dropped. |  |
| check | qpeft/peft_model.py | QuantModel.__init__() | Re-wrapping a QuantModel for the phase switch relies on the tuner handling already-injected layers. |  |
| check | qpeft/peft_model.py | QuantModel.gradient_checkpointing_enable() | Forwards gradient-checkpointing kwargs to the HF model and refuses models without it. |  |
| check | qpeft/peft_model.py | QuantModel.gradient_checkpointing_disable() | Silent no-op when the base model lacks the disable method. |  |
| check | qpeft/peft_model.py | QuantModel.is_merged() | This flag gates saving; a partly merged model must count as not merged. |  |
| check | qpeft/peft_model.py | QuantModel.set_phase() | Phase switch through apply_config; the freeze happens in tuners_utils. |  |
| check | qpeft/quant_schemes/__init__.py | (outside functions) | The new package re-exports; the old qpeft.schemes path is removed with no shim. |  |
| check | qpeft/quant_schemes/base.py | (outside functions) | New SCALE_MIN/SCALE_MAX bounds of 1e-4 and 1e4: check they match the official quantizer and suit fp16 scales. |  |
| check | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.fake_quant() | Same formula as before, but it now works on the clamped and rounded ze from _codes_ste. |  |
| check | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme.quantize() | The artifact codes come from the new _codes_ste. Do .round() and the int32 cast still give integers inside the range? |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.init_qparams() | torchao init now goes through the shared clamp_scale and round_zero_point helpers. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.fake_quant() | torchao fake_quant now goes through the shared helpers. Check that the STE gradient survives the int32 cast of z. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.quantize() | torchao quantize now goes through the shared clamp and round helpers. |  |
| check | qpeft/quant_schemes/torchao.py | TorchaoIntUniformScheme.dequant() | torchao dequant now clamps s, which should match the reference dequant. |  |
| check | qpeft/trainer.py | _block_linear_names() | Heuristic picks the largest ModuleList of Linears; a wrong pick quantizes the wrong layers without error. |  |
| check | qpeft/trainer.py | _prepare_model() | Model preparation refuses non-EfficientQAT and merged models; mistakes here are loud refusals. |  |
| check | qpeft/trainer.py | _GuardCallback.on_train_begin() | Snapshot clones every trainable parameter, which costs memory on large models. |  |
| check | qpeft/trainer.py | _GuardCallback.on_step_begin() | Lr>0 check reads optimizer groups before the scheduler steps; a wrong check disables the guard. |  |
| check | qpeft/trainer.py | _GuardCallback.on_step_end() | Guard compares parameters only once. If this logic is wrong, a frozen run passes without error. |  |
| check | qpeft/trainer.py | _GuardCallback.on_train_end() | Raises when training never reached an lr>0 step. Could it fire falsely on short runs? |  |
| check | qpeft/trainer.py | QATTrainer._set_signature_columns_if_needed() | Signature columns come from base.forward; wrong ones silently drop dataset columns. |  |
| check | qpeft/trainer.py | QATTrainer.compute_loss() | Loss guard raises on non-finite or zero loss; failures here are loud. |  |
| check | qpeft/trainer.py | QATTrainer._block_ap_batches() | Row counting and truncation logic: the Block-AP sample count was buggy before. |  |
| check | qpeft/trainer.py | QATTrainer.train() | Phase hand-over resets the optimizer and scheduler, then runs verify_quant_model. |  |
| check | qpeft/trainer.py | QATTrainer.push_to_hub() | Refuses push_to_hub loudly. |  |
| check | qpeft/tuners/qa_lora/layer.py | ZeroPointFoldLoRA.__init__() | Adapter becomes fp32 on the base layer's device; a wrong device fails loudly. |  |
| check | qpeft/tuners/qa_lora/layer.py | dispatch_default() | Passes the device through to the adapter. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear._init_qparams() | RTN init now runs on an fp32 copy of the weight; the commit notes a precision gap from this. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.codes() | Unpacks codes on every forward, so the cost is performance rather than correctness. |  |
| check | qpeft/tuners/tuners_utils.py | QuantLinear.apply_config() | Phase switch refuses representation changes and un-freezing; any error here is a loud refusal. |  |
| check | qpeft/tuners/tuners_utils.py | BaseQuantTuner.inject_adapters() | Re-injection now switches phase instead of skipping, then freezes non-quant parameters. |  |
| check | qpeft/tuners/tuners_utils.py | BaseQuantTuner._freeze_non_quant_params() | Freezes embeddings, norms and lm_head. Block-AP must re-enable the norms through extra_weights. |  |
| check | qpeft/utils.py | verify_quant_model() | Only QuantLinear under model.base is scanned; a missed wrapper would raise loudly on an empty result. |  |
| check | tests/test_block_ap.py | _mse_pairs() | Parses the log format; a changed log string would break the MSE assertions loudly. |  |
| check | tests/test_block_ap.py | test_every_block_reconstructs_better_after_training() | Checks every block's MSE drops; it relies on the log reporting all blocks. |  |
| check | tests/test_block_ap.py | test_only_block_weights_qparams_and_norms_change() | Suffix allowlist '.weight' also matches norms and non-quant weights inside blocks, so the check is loose. |  |
| check | tests/test_block_ap.py | test_dtypes_and_train_mode_are_restored() | Checks that bf16 dtypes, requires_grad and train mode are restored after Block-AP. |  |
| check | tests/test_block_ap.py | test_refuses_a_model_that_is_not_in_block_ap_phase() | Refusal test for the wrong phase. |  |
| check | tests/test_block_ap.py | test_refuses_without_calibration_batches() | Refusal test for an empty calibration loader. |  |
| check | tests/test_block_ap.py | test_cosine_goes_from_lr_down_to_lr_over_min_lr_factor() | Pins the cosine LR schedule endpoints and its clamp at the floor. |  |
| check | tests/test_config.py | test_efficient_qat_defaults_match_official_code() | Pins the default bits and group size to the official 4/128; the default itself is in config.py. |  |
| check | tests/test_config.py | test_config_roundtrips_through_dict_and_disk() | Config round trip through a dict and through disk. |  |
| check | tests/test_config.py | test_config_from_dict_refuses_an_unknown_field() | Strict load refuses unknown config fields. |  |
| check | tests/test_config.py | test_config_from_dict_refuses_a_different_method() | Loading one method's dict as a different method is refused. |  |
| check | tests/test_custom_models.py | test_scale_only_training_keeps_codes_frozen() | Assertions rewritten from frozen_codes/qweight to the unpacked codes; the comparison still holds codes0 fixed. |  |
| check | tests/test_custom_models.py | test_trainable_weight_has_no_frozen_codes() | Assertion replaced: frozen_codes is None becomes codes_frozen false plus the weight still present. |  |
| check | tests/test_efficient_qat_phases.py | _assert_only_allowed_changed() | Tensors that are None are skipped, so qweight may go unchecked in phases where it does not exist. |  |
| check | tests/test_efficient_qat_phases.py | test_requires_grad_matches_phase() | requires_grad per phase, plus the weight is dropped in E2E-QP. |  |
| check | tests/test_efficient_qat_phases.py | test_training_changes_only_allowed_params() | Training changes exactly the set the phase allows. |  |
| check | tests/test_efficient_qat_phases.py | test_e2e_qp_codes_are_frozen_when_scale_moves() | Frozen codes survive a scale change at atol 1e-6. |  |
| check | tests/test_efficient_qat_phases.py | test_schedule_switches_trainable_set_and_keeps_phase1_results() | The phase switch keeps Block-AP's qparams and freezes the codes from them. |  |
| check | tests/test_examples.py | test_example_runs() | Examples double as tests; they are only as strong as their own asserts. |  |
| check | tests/test_examples.py | test_hf_injection_example_runs() | Skipped when transformers is missing. |  |
| check | tests/test_examples.py | test_every_example_is_covered() | Fails when a new example has no test. |  |
| check | tests/test_merged_format.py | _trained() | fp16 models skip the training steps, so fp16 merge tests only see the random adapter B. |  |
| check | tests/test_merged_format.py | _assert_merged_format() | Pins the packed qweight shape, code range, qparam dtypes and exact state_dict keys. |  |
| check | tests/test_merged_format.py | test_merge_layers_fp32() | Merged equals unmerged within 1e-4 across bits 2/3/4/8. |  |
| check | tests/test_merged_format.py | test_merge_layers_fp16() | fp16 merge is checked only at atol and rtol 1e-2. |  |
| check | tests/test_merged_format.py | test_non_target_layers_untouched() | Non-target head stays an untouched nn.Linear. |  |
| check | tests/test_merged_format.py | test_merge_is_idempotent() | Merging twice changes neither the outputs nor the state. |  |
| check | tests/test_merged_format.py | test_merge_with_nan_adapter_refuses_and_leaves_layer_untouched() | A NaN adapter is refused and the layer state is left untouched. |  |
| check | tests/test_merged_format.py | test_save_load_every_key_equal() | Save and load keep every key exactly equal, including dtypes. |  |
| check | tests/test_packing.py | test_pack_matches_autogptq() | Packing is compared bit for bit with the AutoGPTQ oracle. |  |
| check | tests/test_packing.py | test_unpack_inverts_pack() | Unpack inverts pack for bits 1 to 8 and checks the packed shape. |  |
| check | tests/test_packing.py | test_extreme_codes_survive_the_sign_bit() | Sign-bit case: an arithmetic shift on negative int32 words would corrupt codes. |  |
| check | tests/test_packing.py | test_refuses_what_does_not_fill_whole_words() | Refusals for shapes that do not fill whole words and for out-of-range codes. |  |
| check | tests/test_packing.py | test_layer_refuses_shapes_that_cannot_be_packed() | The layer refuses shapes that cannot be packed when it is built. |  |
| check | tests/test_packing.py | test_merged_codes_take_bits_per_weight() | Storage size is bits per weight and the zero-points stay float. |  |
| check | tests/test_precision.py | test_block_ap_in_bf16_moves_weights_and_keeps_dtypes() | Guards the silent no-learning regression in bf16 Block-AP at official learning rates. |  |
| check | tests/test_precision.py | test_block_ap_trains_norms_and_reduces_the_mean_reconstruction_error() | Norms train, and the log parse via rsplit is brittle to log format changes. |  |
| check | tests/test_precision.py | test_e2e_qp_in_bf16_moves_the_scale() | The E2E-QP scale moves in bf16, then every layer is verified with the new tolerance helper. |  |
| check | tests/test_precision.py | test_qa_lora_adapter_is_fp32_and_moves_in_a_bf16_model() | The QA-LoRA adapter is fp32 and moves inside a bf16 model. |  |
| check | tests/test_precision.py | test_zero_point_is_an_integer_in_training_and_in_the_artifact() | A drifted z is rounded and clamped; merge equals fake_quant exactly. |  |
| check | tests/test_qa_lora_real_model.py | _real_model() | Any load exception becomes a skip, so a broken model load reads as a pass. |  |
| check | tests/test_qa_lora_real_model.py | _oracle_codes() | RTN oracle codes come from the same scheme under test, so this oracle is not independent. |  |
| check | tests/test_qa_lora_real_model.py | test_qa_lora_train_then_merge_is_lossless() | Lossless merge: codes bit-exact, scale unchanged, logits within the tolerance. |  |
| check | tests/test_qat_trainer.py | _args() | Test args override accumulation/warmup; if lr ended up at 0, the phase tests would check nothing. |  |
| check | tests/test_qat_trainer.py | _snap() | Snapshot re-derives codes via scheme.quantize when unfrozen; a wrong oracle would hide code changes. |  |
| check | tests/test_qat_trainer.py | test_accepts_plain_hf_model_and_targets_block_linears() | Pins the default target set and that lm_head stays fp. |  |
| check | tests/test_qat_trainer.py | test_default_config_is_paper_default() | Pins the default config at bits 4, group 128. |  |
| check | tests/test_qat_trainer.py | test_refuses_qa_lora_config() | Refusal of a QA-LoRA config. |  |
| check | tests/test_qat_trainer.py | test_refuses_qa_lora_quant_model() | Refusal of a QA-LoRA QuantModel. |  |
| check | tests/test_qat_trainer.py | test_refuses_targets_that_match_nothing() | Targets that match nothing must raise, not train an unquantized model. |  |
| check | tests/test_qat_trainer.py | test_refuses_merged_model() | Refusal of an already merged model. |  |
| check | tests/test_qat_trainer.py | test_refuses_mid_training_checkpoints() | Refusal of mid-training checkpoints (save_strategy). |  |
| check | tests/test_qat_trainer.py | test_runs_both_phases_with_the_right_trainable_sets() | Monkeypatches Trainer.train to check the phase hand-over; the spy must restore it and assert the right trainable sets. |  |
| check | tests/test_qat_trainer.py | test_bit_dependent_defaults_resolve() | Pins the 2-bit learning-rate defaults (2e-5, 2e-5, 1e-4) against the official code. |  |
| check | tests/test_qat_trainer.py | test_zero_learning_rate_is_caught() | Guard must abort when lr is 0 and nothing moves. |  |
| check | tests/test_qat_trainer.py | test_train_save_load_is_consistent() | Trainer save/load uses a 1e-3 tolerance, not bit-exactness like test_save_load; is the looser bound justified? |  |
| check | tests/test_qat_trainer.py | test_accepts_efficient_qat_quant_model_as_is() | An existing QuantModel must pass through by identity. |  |
| check | tests/test_qat_trainer.py | test_refuses_quant_model_plus_quant_config() | Refusal when both a QuantModel and a quant_config are given. |  |
| check | tests/test_qat_trainer.py | test_e2e_qp_optimizer_trains_only_the_scales_at_e2e_lr() | E2E-QP optimizer must hold only the scales, at e2e_lr, not quant_lr. |  |
| check | tests/test_qat_trainer.py | test_block_ap_hands_over_to_an_e2e_qp_optimizer() | The optimizer after Block-AP must be rebuilt with e2e_lr for the scales only. |  |
| check | tests/test_qat_trainer.py | test_zero_loss_is_caught() | Zero-loss guard with a monkeypatched compute_loss. |  |
| check | tests/test_qat_trainer.py | test_block_ap_batches_hold_exactly_block_ap_train_size_rows() | Regression test for the short-batch row-count bug: exactly block_ap_train_size rows, no labels. |  |
| check | tests/test_qat_trainer.py | test_gradient_checkpointing_trains_both_phases() | Gradient checkpointing must survive both phases. |  |
| check | tests/test_qat_trainer.py | test_gradient_checkpointing_is_refused_for_a_model_without_it() | A base model without checkpointing support must be refused. |  |
| check | tests/test_qat_trainer.py | test_use_cache_goes_to_the_hf_model_not_the_qpeft_config() | use_cache must go to the HF config, not the qpeft config. |  |
| check | tests/test_qat_trainer.py | test_push_to_hub_is_refused_with_a_pointer_to_save_model() | push_to_hub and internal saves refused, and the model must stay unmerged. |  |
| check | tests/test_qat_trainer.py | test_save_model_merges_everywhere_but_writes_only_on_the_main_process() | Non-main ranks must merge but not write. |  |
| check | tests/test_qat_trainer.py | test_star_import_works_without_transformers() | Star import without transformers, run in a subprocess. |  |
| check | tests/test_qat_trainer.py | test_refuses_push_to_hub_argument() | push_to_hub=True must be refused at construction. |  |
| check | tests/test_save_load.py | (outside functions) | CONFIGS decides which methods and bit widths the bit-exact round trip covers. |  |
| check | tests/test_save_load.py | _merged() | A non-zero adapter B is needed, or the fold is trivial and the round trip proves little. |  |
| check | tests/test_save_load.py | test_roundtrip_is_bit_exact() | Bit-exact torch.equal round trip with a different seed, so a silent re-quantization fails. |  |
| check | tests/test_save_load.py | test_merge_drops_float_weight() | After merge, no float weight may remain in the state_dict. |  |
| check | tests/test_save_load.py | test_loaded_model_is_merged_integer_and_frozen() | The loaded model must be merged, int32, frozen, with an equal bias. |  |
| check | tests/test_save_load.py | test_saving_unmerged_model_refuses() | Saving an unmerged model must be refused. |  |
| check | tests/test_save_load.py | test_unknown_contract_in_saved_config_refuses() | An unknown backend or scheme in the saved config must be refused. |  |
| check | tests/test_save_load.py | test_torchao_backend_without_torchao_refuses() | Simulating a missing torchao via sys.modules; does the delitem really force a re-import? |  |
| check | tests/test_save_load.py | test_shape_mismatch_refuses_instead_of_partial_load() | A shape mismatch must raise, not partially load. |  |
| check | tests/test_save_load.py | test_fp16_dtypes_survive_roundtrip() | fp16 scale, zero_point and bias dtypes must survive the round trip. |  |
| check | tests/test_ste_gradients.py | test_clamp_scale_passes_gradient_one() | Pins the STE gradient of 1 through clamp_scale, the double-counting fix. |  |
| check | tests/test_ste_gradients.py | test_round_zero_point_passes_gradient_one() | Pins the STE gradient of 1 through round_zero_point. |  |
| check | tests/test_ste_gradients.py | test_fake_quant_gradients_match_the_official_ste_formula() | Hand-written oracle for d/ds and d/dz; if the oracle formula is wrong, the fix is pinned to a wrong target. |  |
| check | tests/test_ste_gradients.py | test_fp16_codes_round_before_adding_the_zero_point() | fp16 rounding order round(w/s)+z pinned against the official formula. |  |
| check | tests/test_tinygemm.py | _merged() | Merged fixture with a random adapter; the fractional zero-point path depends on it. |  |
| check | tests/test_tinygemm.py | test_tinygemm_zero_gives_the_same_weight() | z_f conversion checked in float64 at atol 1e-12, including fractional zero-points. |  |
| check | tests/test_tinygemm.py | test_int4_pairs_hold_even_columns_in_the_high_nibble() | Pins the nibble order (even columns in the high nibble); a swap would be a silently wrong kernel. |  |
| check | tests/test_tinygemm.py | test_refuses_an_unmerged_layer() | Refusal of an unmerged layer. |  |
| check | tests/test_tinygemm.py | test_refuses_what_the_kernel_cannot_run() | Refusal of 3-bit and group size 16. |  |
| check | tests/test_tinygemm.py | test_refuses_out_features_off_the_kernel_tiles() | Refusal of out_features that are not a multiple of 8. |  |
| check | tests/test_tinygemm.py | test_to_tinygemm_changes_nothing_when_one_layer_is_refused() | No layer may be replaced when a later layer is refused. |  |
| check | tests/test_tinygemm.py | test_refuses_without_cuda() | No-CUDA refusal; the skip means it never runs on the GPU server. |  |
| check | tests/test_tinygemm.py | test_kernel_matches_the_merged_layer() | Kernel vs merged layer within 1e-2 relative error; the negative control shows the bound can fail. |  |
| check | tests/test_tinygemm.py | test_wrong_zero_point_is_caught() | Negative control: an unconverted zero-point must exceed 1e-1 error. |  |
| check | tests/test_tinygemm_real_model.py | setup() | A broad except turns any load error into a skip, so a real regression could show up as a skipped test. |  |
| check | tests/test_tinygemm_real_model.py | test_every_target_runs_on_the_kernel() | Every target must be replaced; the count 7 x layers is hardcoded. |  |
| check | tests/test_tinygemm_real_model.py | test_logits_match_the_merged_model() | Logits and argmax asserts against the U68 thresholds. |  |
| check | tests/test_tinygemm_real_model.py | test_perplexity_matches_the_merged_model() | Perplexity within PPL_RTOL. |  |
| check | tests/test_tinygemm_real_model.py | _next_token_margin() | The margin is measured on the merged model at the shared prefix; the wrong position would excuse real divergence. |  |
| check | tests/test_tinygemm_real_model.py | test_saved_and_loaded_model_runs_the_same_kernel() | save -> load -> to_tinygemm must be bit-identical to the in-memory export. |  |
| check | tests/test_training.py | test_block_ap_groups_weights_and_qparams_with_their_own_lr() | Block-AP groups: weights at weight_lr, scale and zero_point at quant_lr. |  |
| check | tests/test_training.py | test_e2e_qp_groups_only_the_scale() | The E2E-QP group must hold only the scales. |  |
| check | tests/test_training.py | test_qa_lora_groups_only_the_adapter() | QA-LoRA must group only the adapter params, at adapter_lr. |  |
| check | tests/test_training.py | test_every_trainable_parameter_is_in_exactly_one_group() | Each trainable param in exactly one group; a missing one would silently not train. |  |
| check | tests/test_training.py | test_extra_weights_join_the_weight_group() | Norm weights must join the weight group. |  |
| check | tests/test_training.py | test_trainable_parameter_outside_quant_linear_refuses() | Stray trainable params outside QuantLinear must be refused. |  |
| check | tests/test_training.py | test_nothing_trainable_refuses() | Must refuse when nothing is trainable. |  |
| check | tests/test_training.py | test_weight_decay_reaches_every_group() | weight_decay must reach every group. |  |
| skim | .gitignore | lines 15-15 | Adds one gitignore entry for a local task file. |  |
| skim | CLAUDE.md | (outside functions) | Agent notes trimmed; no code is affected. |  |
| skim | README.md | (outside functions) | Docs only, but README lines 97/109/365 still say the codes are unpacked and there is no exporter. |  |
| skim | docs/DESIGN.md | (outside functions) | Path in a doc reference updated to the new module. |  |
| skim | docs/specs/qat_trainer.md | (outside functions) | Spec prose. Only worth reading if you want to compare the promised defaults with trainer.py. |  |
| skim | docs/specs/save_load.md | (outside functions) | Spec prose for save/load; the behaviour itself is in U63/U64. |  |
| skim | examples/README.md | (outside functions) | Example README text. |  |
| skim | examples/qat_trainer.py | (outside functions) | New example script; runs only in the slow tests. |  |
| skim | examples/quickstart.py | (outside functions) | Docstring wording. |  |
| skim | examples/quickstart.py | demo() | The quickstart now switches phase on the same model; it only prints. |  |
| skim | examples/train_efficient_qat.py | (outside functions) | Docstring and import changes in the example. |  |
| skim | examples/train_efficient_qat.py | check_equivalence() | The example now calls verify_quant_model instead of a hand-written loop. |  |
| skim | examples/train_qa_lora.py | (outside functions) | Import swap in the example. |  |
| skim | examples/train_qa_lora.py | main() | The example switches to verify_quant_model. |  |
| skim | qpeft/block_ap.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/block_ap.py | class _StopForward | Sentinel exception class. |  |
| skim | qpeft/block_ap.py | _first() | Tuple unwrap helper. |  |
| skim | qpeft/block_ap.py | _detach() | Recursive detach helper. |  |
| skim | qpeft/config.py | (outside functions) | Imports and the config filename constant. |  |
| skim | qpeft/config.py | class QuantTuningType | Only a comment removed. |  |
| skim | qpeft/config.py | class TrainableParams | Only a comment removed. |  |
| skim | qpeft/config.py | class QuantTuningConfig | Comments removed; defaults unchanged. |  |
| skim | qpeft/kernels/__init__.py | lines 1-4 | Package re-exports. |  |
| skim | qpeft/kernels/tinygemm.py | (outside functions) | Docstring and the kernel constant tuples. |  |
| skim | qpeft/kernels/tinygemm.py | class TinyGemmLinear | Class shell. |  |
| skim | qpeft/packing.py | (outside functions) | Docstring and mask constant. |  |
| skim | qpeft/peft_model.py | (outside functions) | Imports and the weights filename constant. |  |
| skim | qpeft/peft_model.py | class QuantModel | Class outline and section comments. |  |
| skim | qpeft/peft_model.py | QuantModel.quant_layers() | Trivial module filter. |  |
| skim | qpeft/quant_schemes/base.py | class _IntUniformScheme | Blank lines only. |  |
| skim | qpeft/quant_schemes/base.py | class ReferenceIntUniformScheme | Class moved to reference.py; the removal from base.py has no logic of its own. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme._expand() | Moved to reference.py without changes. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.init_qparams() | Old init removed here; its replacement in reference.py is the unit to read. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme._codes_ste() | Old _codes_ste removed; the new rounding order is reviewed in U21. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.fake_quant() | Moved to reference.py without changes. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.quantize() | Moved to reference.py without changes. |  |
| skim | qpeft/quant_schemes/base.py | ReferenceIntUniformScheme.dequant() | Old dequant removed; the new one is U24. |  |
| skim | qpeft/quant_schemes/base.py | register_scheme() | Moved to registry.py without changes. |  |
| skim | qpeft/quant_schemes/base.py | build_scheme() | Moved to registry.py without changes. |  |
| skim | qpeft/quant_schemes/base.py | _int_uniform() | Moved to registry.py; only the import path changed. |  |
| skim | qpeft/quant_schemes/reference.py | (outside functions) | Module header and imports. |  |
| skim | qpeft/quant_schemes/reference.py | class ReferenceIntUniformScheme | Docstring update for the new rounding order. |  |
| skim | qpeft/quant_schemes/reference.py | ReferenceIntUniformScheme._expand() | Moved unchanged: repeat_interleave expansion. |  |
| skim | qpeft/quant_schemes/registry.py | (outside functions) | Module header, registry dict and comments that moved. |  |
| skim | qpeft/quant_schemes/registry.py | register_scheme() | Moved unchanged. |  |
| skim | qpeft/quant_schemes/registry.py | build_scheme() | Moved unchanged. |  |
| skim | qpeft/quant_schemes/registry.py | _int_uniform() | Moved; only the torchao import path changed, and a wrong path would fail loudly. |  |
| skim | qpeft/quant_schemes/torchao.py | (outside functions) | Import paths updated after the package move. |  |
| skim | qpeft/trainer.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/trainer.py | class _GuardCallback | Callback class shell and message. |  |
| skim | qpeft/trainer.py | _GuardCallback.__init__() | Only stores state. |  |
| skim | qpeft/trainer.py | class QATTrainer | Class shell and the save message string. |  |
| skim | qpeft/trainer.py | QATTrainer._log_setup() | Log output only. |  |
| skim | qpeft/training.py | (outside functions) | Module docstring and imports. |  |
| skim | qpeft/tuners/efficient_qat/layer.py | (outside functions) | Import path update. |  |
| skim | qpeft/tuners/qa_lora/layer.py | (outside functions) | Import path update. |  |
| skim | qpeft/tuners/qa_lora/layer.py | class ZeroPointFoldLoRA | Docstring only. |  |
| skim | qpeft/tuners/tuners_utils.py | (outside functions) | Imports. |  |
| skim | qpeft/tuners/tuners_utils.py | class QuantLinear | Class docstring and section comments. |  |
| skim | qpeft/tuners/tuners_utils.py | class BaseQuantTuner | Blank line. |  |
| skim | qpeft/utils.py | (outside functions) | Import path moved from schemes to quant_schemes; a break would fail at import time. |  |
| skim | tests/test_block_ap.py | (outside functions) | Imports and constants for the Block-AP tests. |  |
| skim | tests/test_block_ap.py | _llama() | Tiny random Llama factory for the tests. |  |
| skim | tests/test_block_ap.py | _batches() | Seeded random calibration batches. |  |
| skim | tests/test_block_ap.py | _qmodel() | Builds the quant model for a given phase. |  |
| skim | tests/test_block_ap.py | _run() | Wrapper that runs run_block_ap with fixed learning rates. |  |
| skim | tests/test_config.py | (outside functions) | Import changes and a section header. |  |
| skim | tests/test_efficient_qat_phases.py | (outside functions) | Docstring and the table of trainable sets per phase. |  |
| skim | tests/test_efficient_qat_phases.py | _task() | Synthetic regression task. |  |
| skim | tests/test_efficient_qat_phases.py | _base() | Small base model factory. |  |
| skim | tests/test_efficient_qat_phases.py | _layers() | Collects layers and asserts there is at least one. |  |
| skim | tests/test_efficient_qat_phases.py | _snapshot() | Snapshots layer tensors. |  |
| skim | tests/test_efficient_qat_phases.py | _train() | Short Adam training loop. |  |
| skim | tests/test_efficient_qat_phases.py | _trainable() | Returns the trainable subset of a layer's parameters. |  |
| skim | tests/test_examples.py | (outside functions) | Imports and the examples path. |  |
| skim | tests/test_examples.py | _run() | Runs an example script via runpy. |  |
| skim | tests/test_initialization.py | (outside functions) | Import path rename. |  |
| skim | tests/test_merge_equivalence.py | (outside functions) | Import path rename. |  |
| skim | tests/test_merged_format.py | (outside functions) | Docstring describing the merged-format contract and method table. |  |
| skim | tests/test_merged_format.py | _base() | Base model factory. |  |
| skim | tests/test_packing.py | (outside functions) | Imports. |  |
| skim | tests/test_packing.py | _codes() | Random code generator. |  |
| skim | tests/test_precision.py | (outside functions) | Docstring and imports. |  |
| skim | tests/test_precision.py | _llama_bf16() | bf16 tiny Llama factory. |  |
| skim | tests/test_precision.py | _batches() | Batch builder. |  |
| skim | tests/test_precision.py | _norms() | Selects the norm weights inside blocks. |  |
| skim | tests/test_qa_lora_real_model.py | _tiny_llama() | Tiny Llama factory. |  |
| skim | tests/test_qa_lora_real_model.py | _loss() | Loss helper. |  |
| skim | tests/test_qa_lora_real_model.py | _train_adapters() | Adapter training loop. |  |
| skim | tests/test_qat_trainer.py | (outside functions) | Imports, importorskip on transformers and section comments only. |  |
| skim | tests/test_qat_trainer.py | class _Data | Empty class shell for the fixture dataset. |  |
| skim | tests/test_qat_trainer.py | _Data.__init__() | Seeded random token ids for the fixture. |  |
| skim | tests/test_qat_trainer.py | _Data.__len__() | Trivial __len__. |  |
| skim | tests/test_qat_trainer.py | _Data.__getitem__() | Labels equal to input_ids, the standard causal-LM fixture. |  |
| skim | tests/test_qat_trainer.py | _collate() | Trivial stack collate. |  |
| skim | tests/test_qat_trainer.py | _llama() | Tiny random Llama factory. |  |
| skim | tests/test_qat_trainer.py | _trainer() | Thin constructor wrapper. |  |
| skim | tests/test_qat_trainer.py | _cfg() | Config factory, bits 4 / group 64. |  |
| skim | tests/test_qat_trainer.py | _changed_kinds() | Set of changed tensor kinds by name suffix. |  |
| skim | tests/test_save_load.py | _base() | Seeded small MLP base. |  |
| skim | tests/test_save_load.py | _quant_layers() | Layer filter that asserts it found some. |  |
| skim | tests/test_ste_gradients.py | (outside functions) | Docstring and imports. |  |
| skim | tests/test_ste_gradients.py | _scheme() | Scheme factory. |  |
| skim | tests/test_tinygemm.py | (outside functions) | Imports and the CUDA skip marker. |  |
| skim | tests/test_tinygemm.py | _qalora() | Config factory. |  |
| skim | tests/test_tinygemm.py | _rel_err() | Relative-error helper. |  |
| skim | tests/test_tinygemm_real_model.py | _windows() | WikiText window slicing. |  |
| skim | tests/test_tinygemm_real_model.py | _base() | fp32 model loader. |  |
| skim | tests/test_tinygemm_real_model.py | _logits() | Logits helper. |  |
| skim | tests/test_tinygemm_real_model.py | _ppl() | Mean-of-batch-loss perplexity helper. |  |
| skim | tests/test_tinygemm_real_model.py | _greedy() | Greedy generate helper. |  |
| skim | tests/test_torchao_backend.py | (outside functions) | Import path follows the quant_schemes move. |  |
| skim | tests/test_training.py | (outside functions) | Docstring and LR constants. |  |
| skim | tests/test_training.py | _base() | Base model factory. |  |
| skim | tests/test_training.py | _layers() | Layer filter. |  |
| skim | tests/test_training.py | _ids() | id set helper. |  |
| skim | tests/test_training.py | _by_name() | Group-by-name helper. |  |

## Claude's draft .review-guide.md

```markdown
## Critical
- `qpeft/quant_schemes/**`: the fake_quant / quantize / dequant / merge formulas, STE, scale clamp, zero-point rounding. fake_quant must equal merge.
- `qpeft/packing.py`: the on-disk GPTQ qweight layout, bit for bit.
- `qpeft/kernels/**`: zero-point conversion, int4 packing, bf16 rounding of scales and zeros.
- `qpeft/tuners/tuners_utils.py`: QuantLinear forward, freeze_codes, merge, to_merged_skeleton.
- `qpeft/peft_model.py` save/load, `qpeft/config.py` from_dict/to_dict: the persisted format.
- `qpeft/block_ap.py`, `qpeft/training.py`, `qpeft/trainer.py`: learning rates, schedules, dtype casts, trainable sets per phase, and the defaults in QATTrainingArguments.
- `qpeft/utils.py`: merge tolerances.
- Any test change that loosens a tolerance, removes an assertion or adds a skip (merge-equivalence, STE gradient, packing, save/load tests).

## Source of truth
- Official EfficientQAT (OpenGVLab/EfficientQAT) for the quantizer, Block-AP and E2E-QP defaults; `tests/test_ste_gradients.py` pins the gradients to it.
- AutoGPTQ pack loop for the qweight layout (`tests/test_packing.py`).
- `docs/specs/save_load.md`, `docs/specs/qat_trainer.md` for the promised behaviour and refusals.
- Invariants in `CLAUDE.md` (merge stays int, no stub without its equivalence test).

## Skim
- README.md, docs/, CLAUDE.md, examples/README.md.
- Comment-only edits, import reshuffles, re-export `__init__.py` files.
- Log messages (e.g. the Block-AP MSE log).
```
